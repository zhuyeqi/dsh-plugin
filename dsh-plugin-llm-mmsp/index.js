/**
 * Native MMSP (Model Message Stream Protocol) LLM adapter plugin.
 *
 * One plugin instance owns a dict of provider routes keyed by route name.
 * Every route is configuration-declared: a route names an MMSP server base
 * URL (the SDK spelling, ending before `/stream` — e.g.
 * `https://go.penguin.ooo/api/v1`), an optional credential reference, and an
 * optional curated model list. Profile facts resolve per request over the
 * plugin's user-settings section and the credential seam, so a changed key,
 * endpoint, or model list reaches the next request without a restart; a
 * changed route set re-registers the same adapter instance in place.
 *
 * The web Models page drives the whole lifecycle: the configurable-provider
 * directory registers each route with its settings address, and model
 * discovery interrogates the endpoint's `GET {base}/models` listing (or
 * answers from a curated list without a network call).
 *
 * ```yaml
 * - id: llm-mmsp
 *   name: '@zhuyeqi/dsh-plugin-llm-mmsp'
 *   config:
 *     providers:
 *       penguin-go:
 *         displayName: Penguin Go (MMSP)
 *         baseURL: https://go.penguin.ooo/api/v1
 *         apiKeyEnv: MMSP_API_KEY
 *         models:
 *           - id: deepseek-flash
 *             name: DeepSeek Flash
 *             contextWindow: 131072
 *             maxTokens: 8192
 * ```
 *
 * @module dsh-plugin-llm-mmsp
 */

import z from '@deepseek-ai/schemastery'
import {
  assertUsableApiKey,
  LlmError,
  resolveImageAttachmentAccess,
  resolveRetryPolicy,
  RetryPolicySchema,
} from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'

import { MmspAdapter, THINKING_LEVELS } from './adapter.js'
import { assertBaseURL } from './wire.js'
import { discoverModels } from './discovery.js'

export { MmspAdapter, buildWireRequest, translateEvents } from './adapter.js'
export { discoverModels } from './discovery.js'
export { Config }

export const name = 'llm-mmsp'
export const inject = ['llm']

const NS = 'llm-mmsp'
const PKG = 'dsh-plugin-llm-mmsp'

/** Default maximum idle interval while an adapter stream read is outstanding. */
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Context capacity assumed for a model configuration does not size. */
const DEFAULT_CONTEXT_WINDOW = 131_072
/** Ambient environment variable read when a profile names no credential reference. */
const AMBIENT_KEY_ENV = 'MMSP_API_KEY'

const THINKING_LEVEL_SET = new Set(THINKING_LEVELS)

/** One model of a route's curated list; `id` is the wire model name. */
const modelProfile = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  input: z.array(z.union(['text', 'image'])),
  thinkingLevels: z.array(z.union(THINKING_LEVELS)),
})

/** Configuration for one MMSP provider route; the `providers` dict key IS the route. */
const profile = z.object({
  /** Name shown by configuration surfaces; defaults to the route key. */
  displayName: z.string(),
  /** MMSP server base URL, ending before `/stream` (e.g. `…/api/v1`). */
  baseURL: z.string(),
  /** Credential reference (environment-variable name) resolved per request. */
  apiKeyEnv: z.string().role('credential-ref'),
  /** Extra request headers; Harness attribution wins reserved names. */
  headers: z.dict(z.string()),
  /** The route's curated model list; discovery fills the Models page from the endpoint. */
  models: z.array(modelProfile),
  /** Context capacity for an unlisted model (default 131072). */
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  /** Input modalities for an unlisted model (default `[text]`). */
  defaultInput: z.array(z.union(['text', 'image'])).default(['text']),
  /** `thinking_level` offered as the route's default reasoning effort. */
  thinkingLevel: z.union(THINKING_LEVELS),
  /** Replay assistant thinking as `thinking.done` items (off: most MMSP relays reject unsigned replay). */
  replayThinking: z.boolean().default(false),
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  retryPolicy: RetryPolicySchema,
})

/** Runtime schema for the plugin configuration: the routes this instance owns. */
const Config = z.object({
  providers: z.dict(profile).default({}).volatile(),
})

/**
 * Resolve the raw `providers` dict into detached per-route facts. Structural
 * faults (bad base URL, bad headers) become route diagnostics instead of
 * rejecting the read, so a stored broken route stays editable on the Models
 * page; retry-policy resolution stays strict because the schema already
 * validates its shape.
 * @param providers - the configured provider profiles keyed by route.
 * @returns validated profiles keyed by route.
 */
function resolveProfiles(providers) {
  if (Array.isArray(providers)) {
    throw new Error(`${PKG}: providers must be a dict keyed by provider route, not an array`)
  }
  const resolved = new Map()
  for (const [provider, source] of Object.entries(providers ?? {})) {
    if (provider.length === 0) throw new Error(`${PKG}: provider route names must be non-empty`)
    const errors = []
    let baseURL
    try {
      baseURL = assertBaseURL(source?.baseURL, `provider "${provider}" baseURL`)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    let headers
    if (source?.headers !== undefined && source.headers !== null && typeof source.headers === 'object') {
      try {
        for (const [field, value] of Object.entries(source.headers)) new Headers([[field, value]])
        headers = { ...source.headers }
      } catch {
        errors.push(`provider "${provider}" declares a header Fetch cannot send; use a valid HTTP field name and a single-line value`)
      }
    }
    const models = new Map()
    const modelErrors = new Map()
    for (const entry of Array.isArray(source?.models) ? source.models : []) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.length === 0) {
        errors.push(`provider "${provider}" has a model entry without an id; the entry was dropped`)
        continue
      }
      if (entry.contextWindow !== undefined && !(typeof entry.contextWindow === 'number' && Number.isSafeInteger(entry.contextWindow) && entry.contextWindow >= 1)) {
        modelErrors.set(entry.id, `model "${entry.id}": contextWindow must be a positive integer`)
      }
      if (entry.maxTokens !== undefined && !(typeof entry.maxTokens === 'number' && Number.isSafeInteger(entry.maxTokens) && entry.maxTokens >= 1)) {
        modelErrors.set(entry.id, `model "${entry.id}": maxTokens must be a positive integer`)
      }
      if (entry.input !== undefined && !Array.isArray(entry.input)) {
        modelErrors.set(entry.id, `model "${entry.id}": input must be a list of "text"/"image"`)
      }
      if (entry.thinkingLevels !== undefined && !Array.isArray(entry.thinkingLevels)) {
        modelErrors.set(entry.id, `model "${entry.id}": thinkingLevels must be a list of MMSP thinking_level values`)
      }
      models.set(entry.id, {
        id: entry.id,
        name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : undefined,
        contextWindow: typeof entry.contextWindow === 'number' ? entry.contextWindow : undefined,
        maxTokens: typeof entry.maxTokens === 'number' ? entry.maxTokens : undefined,
        input: Array.isArray(entry.input) && entry.input.length > 0 ? [...entry.input] : undefined,
        thinkingLevels: Array.isArray(entry.thinkingLevels) && entry.thinkingLevels.length > 0 ? [...entry.thinkingLevels] : undefined,
      })
    }
    const resolvedProfile = {
      provider,
      displayName: typeof source?.displayName === 'string' && source.displayName.length > 0 ? source.displayName : provider,
      baseURL,
      ...(headers === undefined ? {} : { headers }),
      ...(typeof source?.apiKeyEnv === 'string' && source.apiKeyEnv.length > 0 ? { apiKeyEnv: source.apiKeyEnv } : {}),
      defaultContextWindow: typeof source?.defaultContextWindow === 'number' ? source.defaultContextWindow : DEFAULT_CONTEXT_WINDOW,
      defaultInput: Array.isArray(source?.defaultInput) && source.defaultInput.length > 0 ? [...source.defaultInput] : ['text'],
      ...(THINKING_LEVEL_SET.has(source?.thinkingLevel) ? { thinkingLevel: source.thinkingLevel } : {}),
      replayThinking: source?.replayThinking === true,
      streamIdleTimeoutMs: typeof source?.streamIdleTimeoutMs === 'number' && source.streamIdleTimeoutMs >= 1 ? source.streamIdleTimeoutMs : DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      retryPolicy: resolveRetryPolicy(source?.retryPolicy, `${PKG}: provider "${provider}" retryPolicy`),
      models,
      modelErrors,
      ...(errors.length === 0 ? {} : { error: errors.join('; ') }),
    }
    resolved.set(provider, resolvedProfile)
  }
  return resolved
}

/** Register one MMSP adapter for every configured provider route. */
export function apply(ctx, config) {
  // The Models page owns this namespace's presentation; no auto-generated
  // settings form beside it.
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  const settingsNs = ctx.fiber?.entry?.options.id ?? NS

  let lastRaw
  let memoized
  const profiles = () => {
    const raw = config.providers.get()
    if (raw === lastRaw && memoized !== undefined) return memoized
    memoized = resolveProfiles(structuredClone(raw))
    lastRaw = raw
    return memoized
  }
  profiles()

  const resolveApiKey = async (provider, profile) => {
    const ref = profile.apiKeyEnv
    if (ref === undefined) {
      // A profile naming no credential at all defers to the ambient MMSP key,
      // matching the nativeAuth the directory declares.
      const ambient = launchEnvironmentOf(ctx).get(AMBIENT_KEY_ENV)?.value
      return ambient !== undefined && ambient.length > 0 ? assertUsableApiKey(ambient, PKG, AMBIENT_KEY_ENV) : undefined
    }
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, PKG, ref)
    throw new LlmError(
      `${PKG}: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not set —`
      + ` store ${ref} through the credentials service (the web Models page writes it) or export it`
      + ` in the app's launch environment, or remove apiKeyEnv to authenticate with the ambient ${AMBIENT_KEY_ENV}`,
      'MISSING_CREDENTIAL',
    )
  }

  const resolveFilePath = attachment => {
    const hostPath = ctx.get('attachments')?.fileHostPath(attachment)
    return hostPath === undefined ? undefined : ctx.get('fs')?.processPathFromHostPath(hostPath)
  }

  const adapter = new MmspAdapter({
    profiles,
    resolveApiKey,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    resolveFilePath,
    warn: message => ctx.logger.warn(message),
  })

  // The configurable-provider directory: every configured route, in settings
  // order, so the Models page can show and edit it while dormant or live.
  let directory
  let directoryFacts
  const ensureDirectory = () => {
    const entries = [...profiles().values()].map(profile => ({
      provider: profile.provider,
      displayName: profile.displayName,
      settingsNs,
      settingsPath: ['providers', profile.provider],
      declared: true,
      ...(profile.baseURL === undefined ? {} : { defaultBaseURL: profile.baseURL }),
      nativeAuth: { env: [AMBIENT_KEY_ENV], oauth: false },
      ...(profile.error === undefined ? {} : { error: profile.error }),
    }))
    if (deepEqualJson(entries, directoryFacts)) return
    if (directory === undefined) directory = ctx.llm.registerConfigurableProviders(entries)
    else directory.replace(entries)
    directoryFacts = entries
  }
  ensureDirectory()

  // Discovery is offered for the whole namespace: the route a surface is
  // adding does not exist yet, and a stored route may still be interrogated.
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => discoverModels(request, {
    profileFor: provider => profiles().get(provider),
    resolveApiKeyFor: (provider, profile) => resolveApiKey(provider, profile),
    ...(signal === undefined ? {} : { signal }),
  }))

  // Route effects: the registry captures the route set and each route's retry
  // policy at registration, so a change to either re-registers the same
  // adapter instance in place. An empty dict is the dormant posture.
  let registration
  let registeredFacts
  const ensureRegistration = () => {
    const facts = [...profiles().values()]
      .map(profile => ({ provider: profile.provider, displayName: profile.displayName, retryPolicy: profile.retryPolicy }))
      .sort((left, right) => left.provider.localeCompare(right.provider))
    if (deepEqualJson(facts, registeredFacts)) return
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistration()

  ctx.on('loader/volatile-update', () => {
    try {
      ensureRegistration()
      ensureDirectory()
    } catch (error) {
      ctx.logger.error(`${PKG}: configuration conflicts with an existing provider route`)
      ctx.logger.error(error)
    }
  })
}
