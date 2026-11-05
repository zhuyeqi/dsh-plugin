/**
 * MMSP wire plumbing: SSE framing, endpoint validation, and provider-error
 * classification for the MMSP Model Adapter.
 *
 * Wire contract (https://mmsp.penguin.ooo, MMSP-RFC series):
 * - `POST {base}/stream` takes `{model, messages, config}` and answers with
 *   server-sent events: one `data: <UniEvent JSON>` per event, then
 *   `data: [DONE]`. While the model is silent the server writes an SSE
 *   comment (a line starting with `:`) every few seconds.
 * - An error is `{"error": {"type", "message", ...fields}}`: the body of an
 *   HTTP error before the stream starts, or one event followed by
 *   `data: [DONE]` once it has.
 * - `GET {base}/models` lists the served models in OpenAI's list shape.
 *
 * @module dsh-plugin-llm-mmsp/wire
 */

import {
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmError,
  ProviderRequestId,
} from '@deepseek-ai/dsh-llm'

/** Largest model-list or error body accepted, bounding bytes actually read. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

/** MMSP route paths a base URL is suffixed with. */
export const STREAM_ROUTE = '/stream'
export const MODELS_ROUTE = '/models'

/** Validate one configured endpoint the way fetch will send it.
 * @param baseURL - the configured MMSP base URL, e.g. `https://host/api/v1`.
 * @param what - configuration label used in the diagnostic.
 * @returns the base URL without trailing slashes.
 */
export function assertBaseURL(baseURL, what = 'baseURL') {
  if (typeof baseURL !== 'string' || baseURL.length === 0) {
    throw new LlmError(`MMSP ${what} is required (the SDK appends ${STREAM_ROUTE} and ${MODELS_ROUTE})`, 'INVALID_CONFIG')
  }
  let url
  try {
    url = new URL(baseURL)
  } catch {
    throw new LlmError(`MMSP ${what} is not a valid URL: ${baseURL}`, 'INVALID_CONFIG')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LlmError(`MMSP ${what} must be http(s), got ${url.protocol}`, 'INVALID_CONFIG')
  }
  if (url.username || url.password) {
    throw new LlmError(`MMSP ${what} must not carry credentials; send the key through the credential seam instead`, 'INVALID_CONFIG')
  }
  return baseURL.replace(/\/+$/, '')
}

/** Decode complete SSE frames from a response body without treating an
 * unterminated tail as an event. Comment lines (the server's keep-alives)
 * and `event:`/`id:`/`retry:` fields are skipped; MMSP sends single-line
 * `data:` payloads only, but multi-line data is re-joined per spec.
 * @param body - provider response bytes.
 * @param activity - pulse the idle watchdog for every chunk and comment.
 * @returns decoded `data:` payloads in arrival order, including `[DONE]`.
 */
export async function* parseSse(body, activity) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let data = ''
  const dispatch = function* () {
    if (data !== '') {
      const payload = data
      data = ''
      yield payload
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      activity()
      buffer += value
      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') yield* dispatch()
        else if (line.startsWith(':')) continue
        else if (line.startsWith('data:')) {
          const field = line.slice(5).replace(/^ /, '')
          data = data === '' ? field : `${data}\n${field}`
        }
      }
    }
    yield* dispatch()
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Classify an MMSP error object or HTTP failure into a Harness error.
 * Mapped codes join llm-retry's default retryable set (`RATE_LIMIT`,
 * `SERVER`, `TIMEOUT`, `TRANSPORT`) plus the neutral context/quota classes,
 * so retry policy needs no MMSP-specific tuning.
 * @param raw - decoded error body or the in-band `{"error": ...}` event.
 * @param status - HTTP status when the error preceded the stream.
 * @param headers - response headers, for Retry-After and request identity.
 * @returns a stable LlmError consumed by LlmRuntime and llm-retry.
 */
export function providerError(raw, status, headers) {
  const envelope = typeof raw === 'object' && raw !== null ? raw : {}
  const error = typeof envelope.error === 'object' && envelope.error !== null ? envelope.error : envelope
  const message = typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : `MMSP request failed (${status ?? 'stream error'})`
  const type = typeof error.type === 'string' ? error.type : typeof error.errorType === 'string' ? error.errorType : ''
  const code = typeof error.code === 'string' ? error.code : ''
  const detail = `${type} ${code} ${message}`
  // An in-band error event carries the upstream's own HTTP status when it
  // has one; the HTTP status of the response wins when the error preceded
  // the stream.
  const wireStatus = typeof error.status === 'number' && error.status >= 100 && error.status <= 599 ? error.status : undefined
  const effective = status ?? wireStatus
  let klass
  if (effective === 401 || effective === 403 || /(?:^|_)(?:authentication|permission|unauthorized|forbidden|api_key|invalid_api_key|vip_required)(?:_|$)/i.test(`${type} ${code}`)) klass = 'AUTH'
  else if (isQuotaExceededError(detail) || effective === 402) klass = 'QUOTA'
  else if (effective === 404 || /(?:^|_)not[_-]?found(?:_|$)/i.test(`${type} ${code}`)) klass = 'UNKNOWN_MODEL'
  else if (effective === 429 || /rate[_-]?limit/i.test(`${type} ${code}`)) klass = 'RATE_LIMIT'
  else if (isContextWindowExceededError(detail)) klass = 'CONTEXT_WINDOW_EXCEEDED'
  else if (effective === 400 || effective === 413 || /invalid[_-]?request/i.test(`${type} ${code}`)) klass = 'INVALID_REQUEST'
  else if ((effective !== undefined && effective >= 500) || /api[_-]?error|overloaded/i.test(`${type} ${code}`)) klass = 'SERVER'
  else klass = effective === undefined ? 'SERVER' : `HTTP_${effective}`
  const retry = headers?.get('retry-after')
  const delay = retry == null ? NaN : /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()
  const id = headers?.get('request-id') ?? headers?.get('x-request-id')
  return new LlmError(message, klass, {
    ...(effective === undefined ? {} : { status: effective }),
    ...(id ? { requestId: ProviderRequestId(id) } : {}),
    ...(Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {}),
  })
}

/** Read and size-bound a full response body as text.
 * @param response - the fetch response to drain.
 * @returns the body text.
 */
export async function readBody(response) {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (text.length > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      throw new LlmError(`MMSP response exceeds ${MAX_BODY_BYTES} bytes`, 'MALFORMED_RESPONSE')
    }
  }
  return text + decoder.decode()
}
