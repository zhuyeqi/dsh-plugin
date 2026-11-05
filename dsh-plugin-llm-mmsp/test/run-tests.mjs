/**
 * Standalone protocol tests for the MMSP adapter against a mock MMSP server.
 * Run: node test/run-tests.mjs  (from the plugin root: node test/run-tests.mjs)
 */
import { createServer } from 'node:http'
import assert from 'node:assert/strict'

import { MmspAdapter, buildWireRequest, translateEvents } from '../adapter.js'
import { discoverModels } from '../discovery.js'
import { providerError, assertBaseURL } from '../wire.js'

// ---------------------------------------------------------------------------
// Minimal resolved-profile factory (mirrors index.js resolveProfiles output).
// ---------------------------------------------------------------------------
function makeProfile(overrides = {}) {
  return {
    provider: 'penguin-go',
    displayName: 'Penguin Go (MMSP)',
    baseURL: 'http://127.0.0.1:0', // replaced per server
    apiKeyEnv: undefined,
    defaultContextWindow: 131072,
    defaultInput: ['text'],
    replayThinking: false,
    streamIdleTimeoutMs: 5000,
    retryPolicy: { mode: 'normal', maxRetries: 0, retryableCodes: [], backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } },
    models: new Map([
      ['deepseek-flash', { id: 'deepseek-flash', name: 'DeepSeek Flash', contextWindow: 131072, maxTokens: 8192, input: undefined, thinkingLevels: undefined }],
    ]),
    modelErrors: new Map(),
    ...overrides,
  }
}

function makeAdapter(profile, warnings = []) {
  const profiles = () => new Map([[profile.provider, profile]])
  return new MmspAdapter({
    profiles,
    resolveApiKey: async () => 'test-key',
    resolveAttachments: () => undefined,
    warn: message => warnings.push(message),
  })
}

function collect(chunkStream) {
  return (async () => {
    const chunks = []
    for await (const chunk of chunkStream) chunks.push(chunk)
    return chunks
  })()
}

// ---------------------------------------------------------------------------
// Mock MMSP server
// ---------------------------------------------------------------------------
async function startServer() {
  const state = { lastBody: null, lastHeaders: null }
  let handler = async () => ({ status: 500, body: { error: { message: 'no scenario' } } })
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (req.url.endsWith('/stream')) state.lastBody = JSON.parse(raw)
    state.lastHeaders = req.headers
    const outcome = await handler(raw, req, res).catch(error => ({ status: 500, body: { error: { message: String(error) } } }))
    if (outcome.sse === true) {
      res.writeHead(outcome.status ?? 200, { 'content-type': 'text/event-stream' })
      for (const frame of outcome.frames) {
        if (typeof frame === 'string' && frame.startsWith(':')) res.write(`${frame}\n\n`)
        else if (frame === '[DONE]') res.write('data: [DONE]\n\n')
        else res.write(`data: ${JSON.stringify(frame)}\n\n`)
        // interleave an await so frames flush separately
        await new Promise(resolve => setImmediate(resolve))
      }
      res.end()
    } else {
      res.writeHead(outcome.status ?? 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(outcome.body ?? {}))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    server,
    state,
    url: `http://127.0.0.1:${port}/api/v1`,
    set handler(next) { handler = next },
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const tests = []
const test = (name, fn) => tests.push([name, fn])

test('baseURL validation', () => {
  assertBaseURL('https://go.penguin.ooo/api/v1')
  assert.equal(assertBaseURL('https://x.example/'), 'https://x.example')
  assert.throws(() => assertBaseURL('ftp://x/'), /http\(s\)/)
  assert.throws(() => assertBaseURL(''), /required/)
  assert.throws(() => assertBaseURL('https://user:pw@x.example/v1'), /credentials/)
})

test('providerError classification', () => {
  assert.equal(providerError({ error: { type: 'invalid_api_key', message: 'bad key' } }, 401).code, 'AUTH')
  assert.equal(providerError({ error: { message: 'rate limited' } }, 429).code, 'RATE_LIMIT')
  assert.equal(providerError({ error: { type: 'upstream_error', message: 'vip_required' } }, 403).code, 'AUTH')
  assert.equal(providerError({ error: { message: 'maximum context length exceeded' } }, 400).code, 'CONTEXT_WINDOW_EXCEEDED')
  assert.equal(providerError({ error: { message: 'insufficient balance' } }, 402).code, 'QUOTA')
  assert.equal(providerError({ error: { message: 'Model request failed' } }, 400).code, 'INVALID_REQUEST')
  assert.equal(providerError({ error: { message: 'boom' } }, 500).code, 'SERVER')
  assert.equal(providerError({ error: { message: 'model not found: nope' } }, 404).code, 'UNKNOWN_MODEL')
  assert.equal(providerError({ error: { message: 'mid-stream' } }, undefined).code, 'SERVER')
})

test('request translation: system fold, tools, thinking_level, reasoning dropped', async () => {
  const profile = makeProfile()
  const options = {
    provider: 'penguin-go',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
    temperature: 0.7,
    maxTokens: 4000,
    tools: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
    messages: [
      { role: 'system', id: 's1', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'You are a coding agent.' }] },
      { role: 'developer', id: 'd1', content: [{ type: 'tool-addition', toolName: 'get_weather' }] },
      { role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Weather in SF?' }] },
      { role: 'assistant', id: 'a1', source: { kind: 'model', provider: 'penguin-go', model: 'deepseek-flash' }, content: [
        { type: 'reasoning', text: 'secret thoughts' },
        { type: 'text', text: 'Let me check.' },
        { type: 'tool-call', id: 'weird id with spaces!!', name: 'get_weather', arguments: '{"city":"SF"}' },
      ] },
      { role: 'tool', id: 't1', source: { kind: 'tool', callId: 'weird id with spaces!!' }, toolCallId: 'weird id with spaces!!', isError: true, content: [{ type: 'text', text: 'timeout' }] },
    ],
  }
  const body = await buildWireRequest(options, profile, {})
  assert.equal(body.model, 'deepseek-flash')
  assert.equal(body.config.system_prompt, 'You are a coding agent.')
  assert.equal(body.config.max_tokens, 4000)
  assert.equal(body.config.temperature, 0.7)
  assert.equal(body.config.thinking_level, 'high')
  assert.deepEqual(body.config.tools, [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }])
  assert.equal(body.messages.length, 3)
  const [user, assistant, toolUser] = body.messages
  assert.equal(user.role, 'user')
  assert.deepEqual(user.content_items, [{ type: 'text.done', text: 'Weather in SF?' }])
  assert.equal(assistant.role, 'assistant')
  // reasoning dropped by default
  assert.equal(assistant.content_items.length, 2)
  assert.deepEqual(assistant.content_items[0], { type: 'text.done', text: 'Let me check.' })
  const call = assistant.content_items[1]
  assert.equal(call.type, 'tool_call.done')
  assert.equal(call.name, 'get_weather')
  assert.deepEqual(call.arguments, { city: 'SF' })
  assert.match(call.tool_call_id, /^call_[0-9a-f]{32}$/)
  // tool result remapped to the same wire id, folded into a user message
  assert.equal(toolUser.role, 'user')
  assert.deepEqual(toolUser.content_items, [{ type: 'tool_result.done', tool_call_id: call.tool_call_id, text: '[The tool reported an error]\ntimeout', images: [] }])

  // replayThinking sends thinking.done
  const withReplay = await buildWireRequest(options, makeProfile({ replayThinking: true }), {})
  const items = withReplay.messages[1].content_items
  assert.deepEqual(items[0], { type: 'thinking.done', thinking: 'secret thoughts' })

  // conforming ids pass through untouched and stay consistent
  const conforming = structuredClone(options)
  conforming.messages[3].content[2] = { type: 'tool-call', id: 'call_00_ET_aaaaabbbbbcccccdd_0123', name: 'get_weather', arguments: '{}' }
  conforming.messages[4].toolCallId = 'call_00_ET_aaaaabbbbbcccccdd_0123'
  const passThrough = await buildWireRequest(conforming, profile, {})
  assert.equal(passThrough.messages[1].content_items[1].tool_call_id, 'call_00_ET_aaaaabbbbbcccccdd_0123')
  assert.equal(passThrough.messages[2].content_items[0].tool_call_id, 'call_00_ET_aaaaabbbbbcccccdd_0123')
})

test('stream translation: text with keepalive and usage mapping', async () => {
  const server = await startServer()
  try {
    const profile = makeProfile({ baseURL: server.url })
    server.handler = async () => ({
      sse: true,
      frames: [
        ': keepalive',
        { role: 'assistant', event_type: 'delta', content_items: [{ type: 'thinking.delta', thinking: 'hmm ' }] },
        { role: 'assistant', event_type: 'delta', content_items: [{ type: 'thinking.delta', thinking: 'ok' }] },
        { role: 'assistant', event_type: 'delta', content_items: [{ type: 'thinking.done', thinking: 'hmm ok' }] },
        { role: 'assistant', event_type: 'delta', content_items: [{ type: 'text.delta', text: 'Hello' }] },
        { role: 'assistant', event_type: 'delta', content_items: [{ type: 'text.delta', text: ', world!' }] },
        { role: 'assistant', event_type: 'delta', content_items: [{ type: 'text.done', text: 'Hello, world!' }] },
        { role: 'assistant', event_type: 'stop', content_items: [], usage_metadata: { prompt_tokens: 10, cached_tokens: 8, thoughts_tokens: 5, response_tokens: 4 }, finish_reason: 'stop' },
        '[DONE]',
      ],
    })
    const adapter = makeAdapter(profile)
    const chunks = await collect(adapter.stream({
      provider: 'penguin-go',
      model: 'deepseek-flash',
      messages: [{ role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
    }))
    const kinds = chunks.map(chunk => `${chunk.type}${chunk.index !== undefined ? `#${chunk.index}` : ''}`)
    assert.deepEqual(kinds, [
      'block-start#0', 'reasoning-delta#0', 'reasoning-delta#0', 'block-end#0',
      'block-start#1', 'text-delta#1', 'text-delta#1', 'block-end#1',
      'usage', 'finish',
    ])
    assert.deepEqual(chunks[3].block, { type: 'reasoning', text: 'hmm ok' })
    assert.deepEqual(chunks[7].block, { type: 'text', text: 'Hello, world!' })
    assert.deepEqual(chunks[8].usage, { inputTokens: 10, outputTokens: 9, cacheReadTokens: 8, reasoningTokens: 5, totalTokens: 27 })
    assert.deepEqual(chunks[9].reason, { kind: 'stop' })
  } finally {
    await server.close()
  }
})

test('stream translation: tool calls with stop-after-tool correction', async () => {
  const server = await startServer()
  try {
    const profile = makeProfile({ baseURL: server.url })
    server.handler = async () => ({
      sse: true,
      frames: [
        { role: 'assistant', event_type: 'delta', content_items: [{ type: 'tool_call.delta', name: 'get_weather', arguments: '{"city":', tool_call_id: 'call_upstream_1' }] },
        { role: 'assistant', event_type: 'delta', content_items: [{ type: 'tool_call.delta', name: '', arguments: '"SF"}', tool_call_id: '' }] },
        { role: 'assistant', event_type: 'delta', content_items: [{ type: 'tool_call.done', name: 'get_weather', arguments: { city: 'SF' }, tool_call_id: 'call_upstream_1' }] },
        { role: 'assistant', event_type: 'stop', content_items: [], usage_metadata: { prompt_tokens: 10, cached_tokens: null, thoughts_tokens: null, response_tokens: 3 }, finish_reason: 'stop' },
        '[DONE]',
      ],
    })
    const adapter = makeAdapter(profile)
    const chunks = await collect(adapter.stream({
      provider: 'penguin-go',
      model: 'deepseek-flash',
      messages: [{ role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
    }))
    const kinds = chunks.map(chunk => chunk.type)
    assert.deepEqual(kinds, ['block-start', 'tool-call-delta', 'tool-call-delta', 'block-end', 'usage', 'finish'])
    assert.equal(chunks[1].name, 'get_weather')
    assert.equal(chunks[2].argumentsDelta, '"SF"}')
    assert.deepEqual(chunks[3].block, { type: 'tool-call', id: 'call_upstream_1', name: 'get_weather', arguments: '{"city":"SF"}' })
    assert.deepEqual(chunks[5].reason, { kind: 'tool-calls' })
    assert.deepEqual(chunks[4].usage, { inputTokens: 10, outputTokens: 3, totalTokens: 13 })
    // request body carried the config the loop sent
    assert.equal(server.state.lastBody.config.thinking_level, undefined)
  } finally {
    await server.close()
  }
})

test('empty stream is EMPTY_RESPONSE; in-band error maps; truncated stream is STREAM_CLOSED', async () => {
  const server = await startServer()
  try {
    const profile = makeProfile({ baseURL: server.url })
    const messages = [{ role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }]
    // empty
    server.handler = async () => ({ sse: true, frames: [{ event_type: 'stop', content_items: [], usage_metadata: { prompt_tokens: 1, response_tokens: 0 }, finish_reason: 'stop' }, '[DONE]'] })
    let adapter = makeAdapter(profile)
    await assert.rejects(
      collect(adapter.stream({ provider: 'penguin-go', model: 'deepseek-flash', messages })),
      error => error.code === 'EMPTY_RESPONSE',
    )
    // in-band error mid-stream (MMSP error events carry the upstream status)
    server.handler = async () => ({ sse: true, frames: [{ error: { type: 'upstream_error', message: 'Model request failed', status: 400 } }, '[DONE]'] })
    adapter = makeAdapter(profile)
    await assert.rejects(
      collect(adapter.stream({ provider: 'penguin-go', model: 'deepseek-flash', messages })),
      error => error.code === 'INVALID_REQUEST',
    )
    // stream ends without stop
    server.handler = async () => ({ sse: true, frames: [{ event_type: 'delta', content_items: [{ type: 'text.delta', text: 'partial' }] }, '[DONE]'] })
    adapter = makeAdapter(profile)
    await assert.rejects(
      collect(adapter.stream({ provider: 'penguin-go', model: 'deepseek-flash', messages })),
      error => error.code === 'STREAM_CLOSED',
    )
    assert.ok(collect === collect)
  } finally {
    await server.close()
  }
})

test('HTTP error before stream maps with status', async () => {
  const server = await startServer()
  try {
    const profile = makeProfile({ baseURL: server.url })
    server.handler = async () => ({ status: 401, body: { error: { type: 'invalid_api_key', message: 'bad key' } } })
    const adapter = makeAdapter(profile)
    await assert.rejects(
      collect(adapter.stream({
        provider: 'penguin-go',
        model: 'deepseek-flash',
        messages: [{ role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
      })),
      error => error.code === 'AUTH' && error.failure.status === 401 && /bad key/.test(error.message),
    )
    // Authorization header sent from the credential seam
    assert.equal(server.state.lastHeaders.authorization, 'Bearer test-key')
    assert.match(String(server.state.lastHeaders['user-agent']), /deepseek-harness\//)
  } finally {
    await server.close()
  }
})

test('caller abort surfaces ABORTED', async () => {
  const server = await startServer()
  try {
    const profile = makeProfile({ baseURL: server.url, streamIdleTimeoutMs: 3000 })
    server.handler = async (raw, req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ event_type: 'delta', content_items: [{ type: 'text.delta', text: 'x' }] })}\n\n`)
      await new Promise(() => {}) // never finish
    }
    const adapter = makeAdapter(profile)
    const controller = new AbortController()
    const stream = adapter.stream({
      provider: 'penguin-go',
      model: 'deepseek-flash',
      signal: controller.signal,
      messages: [{ role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
    })
    const consuming = collect(stream)
    setTimeout(() => controller.abort(), 100)
    await assert.rejects(consuming, error => error.code === 'ABORTED')
  } finally {
    server.close().catch(() => {})
  }
})

test('resolveModel metadata and reasoning efforts', async () => {
  const profile = makeProfile()
  const adapter = makeAdapter(profile)
  const info = await adapter.resolveModel('penguin-go', 'deepseek-flash')
  assert.equal(info.name, 'DeepSeek Flash')
  assert.equal(info.context.contextWindow, 131072)
  assert.equal(info.defaultMaxTokens, 8192)
  assert.deepEqual(info.inputModalities, ['text'])
  assert.deepEqual(info.reasoning.efforts.map(effort => effort.id), ['none', 'low', 'medium', 'high', 'xhigh', 'max'])
  const fallback = await adapter.resolveModel('penguin-go', 'unlisted-model')
  assert.equal(fallback.name, 'unlisted-model')
  assert.equal(fallback.context.contextWindow, 131072)
  const listed = await adapter.listModels('penguin-go')
  assert.deepEqual(listed, [{ provider: 'penguin-go', id: 'deepseek-flash', name: 'DeepSeek Flash', inputModalities: ['text'] }])
})

test('discovery: curated route answers from config; draft interrogates endpoint', async () => {
  const server = await startServer()
  try {
    let modelRequests = 0
    server.handler = async (raw, req) => {
      if (req.url.endsWith('/models')) {
        modelRequests += 1
        return {
          status: 200,
          body: { object: 'list', data: [
            { id: 'deepseek-flash', name: 'DeepSeek Flash' },
            { id: 'gemini-3.5-flash', display_name: 'Gemini 3.5 Flash', context_length: 1048576, max_output_tokens: 65536, input_modalities: ['text', 'image'] },
          ] },
        }
      }
      return { status: 404, body: {} }
    }
    const curated = makeProfile({ baseURL: server.url })
    const fromConfig = await discoverModels({ provider: 'penguin-go' }, {
      profileFor: () => curated,
      resolveApiKeyFor: async () => 'k',
    })
    assert.deepEqual(fromConfig.map(model => model.id), ['deepseek-flash'])
    assert.equal(modelRequests, 0)
    // draft without stored profile interrogates the endpoint
    const fromEndpoint = await discoverModels({ baseURL: server.url, apiKey: 'draft-key' }, {
      profileFor: () => undefined,
      resolveApiKeyFor: async () => { throw new Error('should not resolve') },
    })
    assert.equal(modelRequests, 1)
    assert.deepEqual(fromEndpoint[1], { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', contextWindow: 1048576, maxTokens: 65536, inputModalities: ['text', 'image'] })
    // stored route without declared models is interrogated with its stored credential
    const empty = makeProfile({ baseURL: server.url, models: new Map() })
    await discoverModels({ provider: 'penguin-go' }, {
      profileFor: () => empty,
      resolveApiKeyFor: async () => 'stored-key',
    })
    assert.equal(modelRequests, 2)
  } finally {
    await server.close()
  }
})

// ---------------------------------------------------------------------------
;(async () => {
  let failed = 0
  for (const [name, fn] of tests) {
    try {
      await fn()
      console.log(`ok  - ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL - ${name}`)
      console.error(error)
    }
  }
  console.log(failed === 0 ? `\nall ${tests.length} tests passed` : `\n${failed} of ${tests.length} tests FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})()
