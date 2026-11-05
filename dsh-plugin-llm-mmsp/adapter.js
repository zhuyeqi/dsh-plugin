/**
 * The MMSP adapter: a Harness `LlmAdapter` speaking MMSP directly.
 *
 * Request side: DSH conversation messages map onto UniMessages — system and
 * one-shot prompts fold into `config.system_prompt`, tool results become
 * `tool_result.done` items on user-role messages (consecutive results fold
 * together), images become `inline_data.done` bytes, and tool-call ids that
 * upstream gateways could reject are remapped to `call_…` ids consistently
 * for the call and its result within one request.
 *
 * Response side: UniEvents map onto the Harness chunk protocol — `text.*`,
 * `thinking.*`, and `tool_call.*` items open and close blocks, the `stop`
 * event's `usage_metadata` maps onto the disjoint DSH token accounting
 * (`prompt_tokens` is uncached input; `cached_tokens` rides separately), and
 * an upstream that reports `finish_reason: "stop"` after tool calls is
 * corrected to `tool-calls`.
 *
 * @module dsh-plugin-llm-mmsp/adapter
 */

import { randomUUID } from 'node:crypto'

import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  offloadedImageText,
  projectFilesToText,
  ReasoningEffortId,
  textOnlyImageText,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'

import { assertBaseURL, parseSse, providerError, readBody, STREAM_ROUTE } from './wire.js'

/** MMSP `thinking_level` values; also the selectable reasoning efforts. */
export const THINKING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
const THINKING_LEVEL_SET = new Set(THINKING_LEVELS)

/** Tool-call ids a conservative MMSP gateway accepts verbatim; anything else is remapped per request. */
const SAFE_TOOL_CALL_ID = /^[A-Za-z0-9_-]{8,128}$/

/** MMSP finish reasons to Harness finish kinds. */
const FINISH_KINDS = { stop: 'stop', tool_call: 'tool-calls', length: 'max-tokens' }

/** Build one wire-safe tool-call id for ids a gateway might reject. */
function remapToolCallId(id, idMap) {
  const raw = typeof id === 'string' && id.length > 0 ? id : ''
  if (SAFE_TOOL_CALL_ID.test(raw)) return raw
  let mapped = idMap.get(raw)
  if (mapped === undefined) {
    mapped = `call_${randomUUID().replace(/-/g, '')}`
    idMap.set(raw, mapped)
  }
  return mapped
}

/** Parse a stored tool-call argument string, tolerating provider junk. */
function parseArguments(raw, warn) {
  if (typeof raw !== 'string' || raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    warn?.(`MMSP: stored tool-call arguments are not valid JSON; sent an empty object`)
    return {}
  }
}

/** One user-image occurrence as an MMSP inline item.
 * @param ref - the durable normalized image attachment.
 * @param hooks - adapter-supplied attachment access.
 * @returns the wire item.
 */
async function inlineImageItem(ref, hooks) {
  const attachments = hooks.resolveAttachments?.()
  if (attachments === undefined) {
    throw new LlmError('MMSP image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
  }
  const stored = await attachments.readImage(ref, hooks.signal)
  return { type: 'inline_data.done', mime_type: ref.mediaType, data: Buffer.from(stored.data).toString('base64') }
}

/** Translate one Harness request into the MMSP `{model, messages, config}` body.
 * @param options - the fully assembled Harness request.
 * @param profile - the resolved provider profile.
 * @param hooks - attachment access and diagnostics.
 * @returns the wire request body.
 */
export async function buildWireRequest(options, profile, hooks) {
  const modelEntry = profile.models.get(options.model)
  const inputModalities = modelEntry?.input ?? profile.defaultInput
  const supportsImage = inputModalities.includes('image')

  // Files never reach providers natively; the shared projection replaces each
  // occurrence with its deterministic handle text.
  const messages = projectFilesToText(options.messages, hooks.resolveFilePath)

  const idMap = new Map()
  const wire = []
  let systemPrompt = typeof options.system === 'string' ? options.system : ''

  for (const message of messages) {
    switch (message.role) {
      case 'system': {
        const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
        if (text.length > 0) systemPrompt = systemPrompt.length === 0 ? text : `${systemPrompt}\n\n${text}`
        break
      }
      case 'developer':
        // Tool declarations ride `config.tools`; nothing else in a developer
        // message carries model-visible content.
        break
      case 'user': {
        const items = []
        for (const block of message.content) {
          if (block.type === 'text') {
            if (block.text.length > 0) items.push({ type: 'text.done', text: block.text })
          } else if (block.type === 'image') {
            if (block.offloaded === true) {
              const access = hooks.resolveImageAccess?.(block.attachment)
              items.push({ type: 'text.done', text: offloadedImageText(block.attachment, access) })
            } else if (supportsImage) {
              items.push(await inlineImageItem(block.attachment, hooks))
            } else {
              items.push({ type: 'text.done', text: textOnlyImageText(block.attachment) })
            }
          } else if (block.type === 'reasoning' && profile.replayThinking && block.text.length > 0) {
            items.push({ type: 'thinking.done', thinking: block.text })
          }
        }
        if (items.length > 0) wire.push({ role: 'user', content_items: items })
        break
      }
      case 'assistant': {
        const items = []
        for (const block of message.content) {
          if (block.type === 'text') {
            if (block.text.length > 0) items.push({ type: 'text.done', text: block.text })
          } else if (block.type === 'reasoning') {
            if (profile.replayThinking && block.text.length > 0) items.push({ type: 'thinking.done', thinking: block.text })
          } else if (block.type === 'tool-call') {
            items.push({
              type: 'tool_call.done',
              name: block.name,
              arguments: parseArguments(block.arguments, hooks.warn),
              tool_call_id: remapToolCallId(block.id, idMap),
            })
          } else if (block.type === 'image') {
            hooks.warn?.('MMSP: an image block in assistant history was sent as placeholder text (text-only replay)')
            items.push({ type: 'text.done', text: textOnlyImageText(block.attachment) })
          }
        }
        if (items.length > 0) wire.push({ role: 'assistant', content_items: items })
        break
      }
      case 'tool': {
        const callId = remapToolCallId(message.toolCallId ?? message.source?.callId, idMap)
        let text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
        if (message.isError === true) text = `[The tool reported an error]\n${text}`
        const item = { type: 'tool_result.done', tool_call_id: callId, text, images: [] }
        // Consecutive tool results fold into one user message, as MMSP servers expect.
        const last = wire[wire.length - 1]
        if (last !== undefined && last.role === 'user'
          && last.content_items.length > 0
          && last.content_items.every(entry => entry.type === 'tool_result.done')) {
          last.content_items.push(item)
        } else {
          wire.push({ role: 'user', content_items: [item] })
        }
        break
      }
      default:
        break
    }
  }

  const config = {}
  if (systemPrompt.length > 0) config.system_prompt = systemPrompt
  if (typeof options.maxTokens === 'number') config.max_tokens = options.maxTokens
  if (typeof options.temperature === 'number') config.temperature = options.temperature
  if (Array.isArray(options.tools) && options.tools.length > 0) {
    config.tools = options.tools.map(tool => ({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      parameters: tool.parameters !== null && typeof tool.parameters === 'object'
        ? tool.parameters
        : { type: 'object', properties: {} },
    }))
  }
  if (typeof options.reasoningEffort === 'string' && THINKING_LEVEL_SET.has(options.reasoningEffort)) {
    config.thinking_level = options.reasoningEffort
  }

  if (wire.length === 0) {
    throw new LlmError('MMSP request has no translatable conversation content', 'INVALID_REQUEST')
  }
  return { model: options.model, messages: wire, config }
}

/** Map the stop event's `usage_metadata` onto the disjoint DSH accounting. */
function usageOf(meta) {
  const count = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0)
  const thoughts = count(meta?.thoughts_tokens)
  const usage = {
    inputTokens: count(meta?.prompt_tokens),
    outputTokens: thoughts + count(meta?.response_tokens),
  }
  if (typeof meta?.cached_tokens === 'number' && meta.cached_tokens >= 0) usage.cacheReadTokens = meta.cached_tokens
  if (thoughts > 0) usage.reasoningTokens = thoughts
  usage.totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0)
  return usage
}

/** Incremental UniEvent-to-chunk translator. MMSP items never interleave, so
 * exactly one block is open at a time; each item's `.done` event closes it
 * with the authoritative content.
 * @param events - decoded UniEvents in arrival order.
 * @param model - the requested model id for diagnostics.
 * @param warn - sink for skipped-content diagnostics.
 * @returns the Harness chunk stream, ending with exactly one terminal finish.
 */
export async function* translateEvents(events, model, warn) {
  const state = { current: undefined, nextIndex: 0, toolCount: 0, blockCount: 0 }
  const warnedTypes = new Set()
  const warnOnce = (type, detail) => {
    if (warnedTypes.has(type)) return
    warnedTypes.add(type)
    warn?.(`MMSP stream on "${model}": ${detail}`)
  }

  function* startBlock(kind, id, name) {
    const index = state.nextIndex
    state.nextIndex += 1
    state.blockCount += 1
    const block = kind === 'tool-call'
      ? { kind, index, id: String(id ?? ''), name: typeof name === 'string' ? name : '', text: '', args: '' }
      : { kind, index, text: '' }
    state.current = block
    yield { type: 'block-start', index, blockType: kind }
    if (kind === 'tool-call') {
      yield {
        type: 'tool-call-delta',
        index,
        id: ToolCallId(block.id),
        ...(block.name.length > 0 ? { name: block.name } : {}),
        argumentsDelta: '',
      }
    }
    return block
  }

  function* closeOpen(finalBlock) {
    const block = state.current
    state.current = undefined
    if (block === undefined) return
    switch (block.kind) {
      case 'text':
        yield { type: 'block-end', index: block.index, block: finalBlock ?? { type: 'text', text: block.text } }
        break
      case 'reasoning':
        yield { type: 'block-end', index: block.index, block: finalBlock ?? { type: 'reasoning', text: block.text } }
        break
      case 'tool-call': {
        let closed = finalBlock
        if (closed === undefined) {
          closed = {
            type: 'tool-call',
            id: ToolCallId(block.id),
            name: block.name,
            arguments: JSON.stringify(parseArguments(block.args, warn)),
          }
        }
        state.toolCount += 1
        yield { type: 'block-end', index: block.index, block: closed }
        break
      }
    }
  }

  function* openText(kind, itemText, doneText) {
    yield* closeOpen()
    const block = yield* startBlock(kind)
    if (typeof itemText === 'string' && itemText.length > 0) block.text += itemText
    if (typeof itemText === 'string' && itemText.length > 0) {
      yield { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', index: block.index, text: itemText }
    }
    if (doneText !== undefined) {
      yield* closeOpen(kind === 'text' ? { type: 'text', text: doneText } : { type: 'reasoning', text: doneText })
    }
  }

  for await (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (event.event_type === 'stop') {
      yield* closeOpen()
      const wireReason = typeof event.finish_reason === 'string' && event.finish_reason.length > 0 ? event.finish_reason : 'stop'
      let finish = FINISH_KINDS[wireReason] ?? 'stop'
      // Some upstreams report "stop" after tool calls; Harness semantics
      // require the tool-call kind so the loop dispatches the calls.
      if (finish === 'stop' && state.toolCount > 0) finish = 'tool-calls'
      if (state.blockCount === 0 && finish === 'stop') {
        throw new LlmError(`MMSP model "${model}" returned no content`, 'EMPTY_RESPONSE')
      }
      yield { type: 'usage', usage: usageOf(event.usage_metadata) }
      yield { type: 'finish', reason: { kind: finish } }
      return
    }
    const items = Array.isArray(event.content_items) ? event.content_items : []
    for (const item of items) {
      if (item === null || typeof item !== 'object' || typeof item.type !== 'string') continue
      switch (item.type) {
        case 'text.delta': {
          if (state.current?.kind !== 'text') yield* openText('text', '')
          const text = typeof item.text === 'string' ? item.text : ''
          if (text.length > 0) {
            state.current.text += text
            yield { type: 'text-delta', index: state.current.index, text }
          }
          break
        }
        case 'text.done': {
          const doneText = typeof item.text === 'string' ? item.text : undefined
          if (state.current?.kind !== 'text') yield* openText('text', doneText ?? '', doneText)
          else yield* closeOpen({ type: 'text', text: doneText ?? state.current.text })
          break
        }
        case 'thinking.delta': {
          if (state.current?.kind !== 'reasoning') yield* openText('reasoning', '')
          const text = typeof item.thinking === 'string' ? item.thinking : ''
          if (text.length > 0) {
            state.current.text += text
            yield { type: 'reasoning-delta', index: state.current.index, text }
          }
          break
        }
        case 'thinking.done': {
          const doneText = typeof item.thinking === 'string' ? item.thinking : undefined
          if (state.current?.kind !== 'reasoning') yield* openText('reasoning', doneText ?? '', doneText)
          else yield* closeOpen({ type: 'reasoning', text: doneText ?? state.current.text })
          break
        }
        case 'tool_call.delta': {
          const id = typeof item.tool_call_id === 'string' && item.tool_call_id.length > 0 ? item.tool_call_id : ''
          if (id.length > 0 && (state.current?.kind !== 'tool-call' || state.current.id !== id)) {
            yield* closeOpen()
            yield* startBlock('tool-call', id, typeof item.name === 'string' ? item.name : '')
            state.current.args += typeof item.arguments === 'string' ? item.arguments : ''
          } else if (state.current?.kind === 'tool-call') {
            if (typeof item.name === 'string' && item.name.length > 0 && state.current.name.length === 0) {
              state.current.name = item.name
            }
            const argsDelta = typeof item.arguments === 'string' ? item.arguments : ''
            if (argsDelta.length > 0) state.current.args += argsDelta
            if (argsDelta.length > 0) {
              yield {
                type: 'tool-call-delta',
                index: state.current.index,
                id: ToolCallId(state.current.id),
                argumentsDelta: argsDelta,
              }
            }
          } else {
            warnOnce(item.type, 'tool_call.delta arrived with no open tool call; skipped')
          }
          break
        }
        case 'tool_call.done': {
          const id = typeof item.tool_call_id === 'string' && item.tool_call_id.length > 0 ? item.tool_call_id : ''
          const name = typeof item.name === 'string' ? item.name : ''
          const closed = {
            type: 'tool-call',
            id: ToolCallId(id),
            name,
            arguments: JSON.stringify(item.arguments !== null && typeof item.arguments === 'object' ? item.arguments : {}),
          }
          if (state.current?.kind !== 'tool-call') {
            yield* startBlock('tool-call', id, name)
          }
          yield* closeOpen(closed)
          break
        }
        case 'image_url.done':
        case 'inline_data.done':
          warnOnce(item.type, 'an image output item was skipped (the harness does not consume assistant images)')
          break
        case 'tool_result.done':
          warnOnce(item.type, 'a tool_result output item was skipped (tool results are inputs, not outputs)')
          break
        default:
          warnOnce(item.type, `stream item "${item.type}" is not recognized; skipped`)
          break
      }
    }
  }
  throw new LlmError('MMSP stream ended before its stop event', 'STREAM_CLOSED')
}

/** Decode SSE payloads into UniEvents, raising in-band errors and honoring [DONE]. */
async function* uniEvents(payloads) {
  for await (const payload of payloads) {
    if (payload === '[DONE]') return
    let event
    try {
      event = JSON.parse(payload)
    } catch {
      throw new LlmError('MMSP SSE contains invalid JSON', 'MALFORMED_RESPONSE')
    }
    if (event !== null && typeof event === 'object' && 'error' in event) throw providerError(event, undefined)
    yield event
  }
}

/** One route's profile facts the adapter reads per operation. */
export class MmspAdapter extends LlmAdapter {
  /** @param deps - {profiles, resolveApiKey, resolveAttachments, resolveImageAccess, resolveFilePath, warn} */
  constructor(deps) {
    super()
    this.deps = deps
  }

  #profile(provider) {
    const profile = this.deps.profiles().get(provider)
    if (profile === undefined) throw new LlmError(`MMSP adapter does not own provider "${provider}"`, 'NO_ADAPTER')
    if (profile.error !== undefined) throw new LlmError(profile.error, 'INVALID_CONFIG')
    return profile
  }

  providerInfo(provider) {
    return { id: provider, name: this.deps.profiles().get(provider)?.displayName ?? provider }
  }

  providerRetryPolicy(provider) {
    return this.deps.profiles().get(provider)?.retryPolicy
  }

  async listModels(provider) {
    const profile = this.#profile(provider)
    try {
      await this.deps.resolveApiKey(provider, profile)
    } catch (error) {
      // A route whose named key does not resolve offers no models until the key is stored.
      if (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL') return []
      throw error
    }
    return [...profile.models.values()].map(entry => ({
      provider,
      id: entry.id,
      name: entry.name ?? entry.id,
      inputModalities: [...(entry.input ?? profile.defaultInput)],
    }))
  }

  async resolveModel(provider, model, _signal) {
    const profile = this.#profile(provider)
    const modelError = profile.modelErrors.get(model)
    if (modelError !== undefined) throw new LlmError(modelError, 'INVALID_CONFIG')
    const entry = profile.models.get(model)
    const levels = entry?.thinkingLevels ?? THINKING_LEVELS
    const defaultEffort = profile.thinkingLevel !== undefined && levels.includes(profile.thinkingLevel)
      ? profile.thinkingLevel
      : undefined
    return {
      provider,
      id: model,
      name: entry?.name ?? model,
      inputModalities: [...(entry?.input ?? profile.defaultInput)],
      context: { contextWindow: entry?.contextWindow ?? profile.defaultContextWindow },
      ...(typeof entry?.maxTokens === 'number' ? { defaultMaxTokens: entry.maxTokens } : {}),
      reasoning: {
        efforts: levels.map(level => ({
          id: ReasoningEffortId(level),
          name: level === 'none' ? 'Off' : `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
        })),
        ...(defaultEffort === undefined ? {} : { defaultEffort: ReasoningEffortId(defaultEffort) }),
      },
    }
  }

  async prepareCall(provider, model, signal) {
    const profile = this.#profile(provider)
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: options => this.#generate(options, profile),
    }
  }

  stream(options) {
    return this.#generate(options, this.#profile(options.provider))
  }

  async *#generate(options, profile) {
    const consumer = new AbortController()
    const signal = options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(signal, profile.streamIdleTimeoutMs, 'MMSP_STREAM_IDLE')
    const iterator = this.#request(options, profile, watchdog.signal, () => watchdog.pulse())
    try {
      while (true) {
        const next = await watchdog.next(iterator)
        if (next.done) return
        yield next.value
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, 'MMSP_STREAM_IDLE') !== undefined) {
        throw new LlmError(`MMSP stream idle timeout after ${profile.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) throw new LlmError('MMSP request aborted by caller', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError('MMSP transport failed', 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('MMSP stream consumer stopped')
      // The abort above owns socket teardown; a demand the deadline abandoned
      // can stay pending forever, so the drain is detached.
      void iterator.return(undefined).catch(() => {})
    }
  }

  async *#request(options, profile, signal, activity) {
    signal.throwIfAborted()
    const baseURL = assertBaseURL(profile.baseURL, `provider "${profile.provider}" baseURL`)
    const apiKey = await this.deps.resolveApiKey(profile.provider, profile)
    const hooks = {
      resolveAttachments: this.deps.resolveAttachments,
      resolveImageAccess: this.deps.resolveImageAccess,
      resolveFilePath: this.deps.resolveFilePath,
      warn: this.deps.warn,
      signal,
    }
    const body = await buildWireRequest(options, profile, hooks)
    const headers = {
      ...attributionHeaders(),
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...profile.headers,
      ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
    }
    let response
    try {
      response = await fetch(`${baseURL}${STREAM_ROUTE}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      })
    } catch (error) {
      if (signal.aborted) throw new LlmError('MMSP request aborted', 'ABORTED', { cause: error })
      throw error
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
    if (response.body === null) throw new LlmError('MMSP stream returned no response body', 'EMPTY_RESPONSE')
    yield* translateEvents(uniEvents(parseSse(response.body, activity)), options.model, this.deps.warn)
  }
}
