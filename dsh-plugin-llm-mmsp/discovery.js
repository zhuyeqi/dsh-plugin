/**
 * Answering "which models does this MMSP endpoint serve?" for the Models
 * page's fetch action.
 *
 * A route whose profile declares an explicit model list answers from that
 * configuration with no network call — the settings document is the better
 * answer for a route already curated. Anything else (a draft being edited, a
 * route with no declared models) interrogates the endpoint's OpenAI-shaped
 * `GET {base}/models` listing.
 *
 * Nothing here is stored: the request carries a draft the user is still
 * editing, and the reply is candidate metadata the surface offers for
 * adoption.
 *
 * @module dsh-plugin-llm-mmsp/discovery
 */

import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'

import { assertBaseURL, MODELS_ROUTE, providerError, readBody } from './wire.js'

/** A positive integer field of a listing entry, or `undefined`. */
function capacity(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/** Project one listing entry onto a discovered model. */
function entryToModel(entry) {
  if (entry === null || typeof entry !== 'object') return undefined
  const id = label(entry.id)
  if (id === undefined) return undefined
  const architecture = entry.architecture !== null && typeof entry.architecture === 'object' ? entry.architecture : undefined
  const modalities = entry.input_modalities ?? architecture?.input_modalities
  const discovered = { id, ...label(entry.name, entry.display_name, entry.displayName) !== undefined ? { name: label(entry.name, entry.display_name, entry.displayName) } : {} }
  const contextWindow = capacity(
    entry.contextWindow, entry.context_window, entry.context_length, entry.max_input_tokens,
    entry.limit?.context,
  )
  const maxTokens = capacity(
    entry.maxTokens, entry.max_tokens, entry.max_output_tokens,
    entry.limit?.output, entry.top_provider?.max_completion_tokens,
  )
  if (contextWindow !== undefined) discovered.contextWindow = contextWindow
  if (maxTokens !== undefined) discovered.maxTokens = maxTokens
  if (Array.isArray(modalities) && modalities.includes('image')) discovered.inputModalities = ['text', 'image']
  return discovered
}

/** Run one discovery interrogation.
 * @param request - the Models page's draft request (`provider`, `baseURL`, `apiKey`).
 * @param context - host-side access to stored routes and their credentials.
 * @returns discovered models in endpoint order.
 */
export async function discoverModels(request, context) {
  const profile = typeof request.provider === 'string' ? context.profileFor(request.provider) : undefined
  if (profile !== undefined && profile.error === undefined && profile.models.size > 0) {
    return [...profile.models.values()].map(entry => ({
      id: entry.id,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
      ...(entry.maxTokens === undefined ? {} : { maxTokens: entry.maxTokens }),
      ...(entry.input === undefined ? {} : { inputModalities: [...entry.input] }),
    }))
  }
  const baseURL = assertBaseURL(request.baseURL ?? profile?.baseURL, 'discovery baseURL')
  let apiKey = request.apiKey
  if (apiKey === undefined && request.provider !== undefined && profile !== undefined) {
    apiKey = await context.resolveApiKeyFor(request.provider, profile)
  }
  let response
  try {
    response = await fetch(`${baseURL}${MODELS_ROUTE}`, {
      headers: {
        ...attributionHeaders(),
        accept: 'application/json',
        ...(apiKey === undefined || apiKey.length === 0 ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      redirect: 'error',
    })
  } catch (error) {
    if (request.signal?.aborted) throw new LlmError('MMSP model discovery aborted', 'ABORTED', { cause: error })
    throw new LlmError('MMSP model discovery request failed', 'TRANSPORT', { cause: error })
  }
  if (!response.ok) {
    let raw
    const text = await readBody(response)
    try {
      raw = JSON.parse(text)
    } catch {
      raw = { error: { message: text.slice(0, 500) || response.statusText } }
    }
    throw providerError(raw, response.status, response.headers)
  }
  let parsed
  try {
    parsed = JSON.parse(await readBody(response))
  } catch {
    throw new LlmError('MMSP model listing is not valid JSON', 'MALFORMED_RESPONSE')
  }
  const rows = Array.isArray(parsed?.data)
    ? parsed.data
    : Array.isArray(parsed) ? parsed : []
  const models = rows.map(entryToModel).filter(model => model !== undefined)
  if (models.length === 0) {
    throw new LlmError('MMSP model listing carried no recognizable model entries', 'MALFORMED_RESPONSE')
  }
  return models
}
