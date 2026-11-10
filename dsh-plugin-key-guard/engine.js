/**
 * key-guard engine: outbound masking + inbound restore for model traffic.
 *
 * Pure logic, no Cordis dependency, so it is directly unit-testable with node.
 *
 * Threat model: the remote model (or anything injected into its context)
 * must never see a real credential. Every model request is masked on the way
 * out; when the model echoes a placeholder back (in assistant text or tool
 * call arguments), the placeholder is restored to the real key so local
 * execution keeps working. The real key therefore stays on this machine.
 *
 * Placeholder grammar: <<DSHKEY#n>>  (n = 1..99999, case-insensitive on
 * restore, tolerant to the model altering nothing else). Restoration only
 * happens for ids that were actually masked into THAT request's outbound
 * copy, so a prompt injection cannot probe for keys it never legitimately
 * saw by guessing placeholder ids.
 */

/** Match one complete placeholder. Case-insensitive: models sometimes
 * lowercase what they echo. Callers must not rely on lastIndex. */
const PLACEHOLDER_FULL = /<<DSHKEY#(\d{1,5})>>/i;

/** Placeholder head, lowercased for prefix comparisons. */
const PLACEHOLDER_HEAD = '<<dshkey#';

/**
 * Length of the trailing slice of `buffer` that could still grow into a
 * complete placeholder (any proper prefix: '<', '<<', '<<DSH', …,
 * '<<DSHKEY#', '<<DSHKEY#123'). Such tails are held back until the next
 * delta or the block's end; anything else is emitted immediately.
 */
function holdbackLength(buffer) {
  const window = buffer.slice(-(PLACEHOLDER_HEAD.length + 7));
  let best = 0;
  for (let i = window.indexOf('<'); i !== -1; i = window.indexOf('<', i + 1)) {
    const tail = window.slice(i).toLowerCase();
    const plausible = tail.length <= PLACEHOLDER_HEAD.length
      ? PLACEHOLDER_HEAD.startsWith(tail)
      : /^[0-9]{1,5}$/.test(tail.slice(PLACEHOLDER_HEAD.length));
    if (plausible) best = Math.max(best, tail.length);
  }
  return best;
}

/** Placeholder body, used when composing masked text. */
function placeholderFor(id, mode) {
  return mode === 'redact' ? '<<REDACTED>>' : `<<DSHKEY#${id}>>`;
}

/** Built-in AI/LLM credential patterns. Each is anchored on token
 * boundaries and long enough to avoid ordinary-word false positives.
 *
 * Applied SEQUENTIALLY (pattern-major), never fused into one alternation.
 * v0.5.0 fused them into a single regex and that was a security regression:
 * fusion switches to position-major semantics, so a later-listed branch whose
 * char class contains `-` (only slack) can swallow the PREFIX of an
 * earlier-listed token and stop at `_`, leaving a suffix that the earlier
 * branch's `\b` anchor can never match again — the key body then leaves the
 * machine in cleartext (e.g. `xoxb-…-ghp_…` leaked 32/35 body chars).
 * Sequential rewriting is what restores byte-for-byte equivalence with
 * v0.4.0; the prefix screen and the frozen-message cache supply the actual
 * performance win. These regexes are module-level and state-free to share:
 * `String.replace` with a /g regex resets lastIndex before and after. */
const BUILTIN_PATTERNS = [
  ['openai-compatible', /\bsk-(?!ant-)[A-Za-z0-9][A-Za-z0-9_-]{19,}\b/g],
  ['anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['google-api', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['github-fine-grained', /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ['huggingface-token', /\bhf_[A-Za-z0-9]{30,}/g],
  ['replicate-token', /\br8_[A-Za-z0-9]{30,}/g],
];

/** Cheap pre-screen: every builtin match begins with one of these literal
 * prefixes. A screen miss proves no builtin can match (case-insensitive
 * superset of the case-sensitive originals), so the overwhelming "no
 * credential here" string never reaches the detector at all. Non-global, so
 * `.test()` carries no lastIndex state. */
const BUILTIN_SCREEN = /(?:sk-|akia|aiza|gh[pousr]_|github_pat_|xox|glpat-|hf_|r8_)/i;

/** Monotonic clock for perf counters; performance.now when available. */
const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? () => performance.now()
  : () => Date.now();

/** Longest built-in match length is ~200 chars; placeholders are ~16. */
const MAX_PLACEHOLDER_CHARS = 16;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deep-freeze a value built by this module (a masked message). Iterative so a
 * pathological nesting depth cannot blow the call stack, cycle-safe, and it
 * leaves AbortSignal alone (freezing one breaks its abort channel — the same
 * carve-out DSH's own deepFreeze makes). Only ever called on objects the guard
 * itself constructs, never on caller input.
 */
function deepFreezeValue(value, seen = new Set()) {
  const pending = [value];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === null || typeof node !== 'object' || seen.has(node)) continue;
    if (typeof AbortSignal !== 'undefined' && node instanceof AbortSignal) continue;
    seen.add(node);
    Object.freeze(node);
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child !== null && typeof child === 'object') pending.push(child);
    }
  }
  return value;
}

/**
 * Build one guard instance. `options`:
 * - mode: 'placeholder' (reversible, default) | 'redact' (never restored)
 * - patterns: extra regex source strings, applied case-insensitively
 * - exactKeys: literal secrets always masked verbatim (highest priority)
 * - onConfigWarning: called with a message for unusable config entries
 */
export function createKeyGuard(rawOptions = {}) {
  const warn = typeof rawOptions.onConfigWarning === 'function' ? rawOptions.onConfigWarning : () => {};

  // --- vault: stable per-process ids for real keys ----------------------
  const idByKey = new Map();
  const keyById = new Map();
  let nextId = 1;

  function idFor(key) {
    let id = idByKey.get(key);
    if (id === undefined) {
      id = nextId++;
      if (id > 99999) id = 99999; // hard cap; collisions only in pathological volume
      idByKey.set(key, id);
      keyById.set(id, key);
    }
    return id;
  }

  // --- compiled detectors (hot-reloadable via syncRules) ------------------
  let mode = rawOptions.mode === 'redact' ? 'redact' : 'placeholder';
  let extraPatterns = [];
  let exactKeys = [];

  // --- memoized masking of immutable messages ------------------------------
  // DSH deep-freezes each session message once and reuses the same object
  // across requests, so a frozen message's masked form depends only on the
  // rules. Cache it per message (WeakMap: entries die with the message);
  // `rulesEpoch` bumps when the rules change, invalidating the whole cache in
  // one step. Only messages that are immutable top-to-bottom are cached —
  // mutable ones could be edited after caching, and a stale hit would be a
  // missed credential, not a stale view.
  const messageCache = new WeakMap();
  let rulesEpoch = 0;
  let rulesSignature = null;

  // --- perf counters, exposed via stats() (numbers only, never keys) -------
  const perf = {
    stringsScanned: 0,   // maskText invocations on a non-empty string
    detectorPasses: 0,   // strings that reached the builtin detectors
    screenSkips: 0,      // strings skipped by the prefix screen, builtins only
    cacheHits: 0,        // message-cache hits
    cacheMisses: 0,      // message-cache misses (cacheable messages only)
    requestsMasked: 0,   // outbound passes (in-place or clone) that masked
    maskMs: 0,           // CPU time in outbound masking
    chunks: 0,           // stream chunks transformed by restore
    restoreMs: 0,        // CPU time in the restore transform (excludes backpressure)
  };

  function buildRules(raw) {
    const nextMode = raw.mode === 'redact' ? 'redact' : 'placeholder';
    const patterns = [];
    const sources = Array.isArray(raw.patterns) ? raw.patterns : [];
    for (const source of sources) {
      if (typeof source !== 'string' || source.length === 0) continue;
      try {
        patterns.push(new RegExp(source, 'gi'));
      } catch (error) {
        warn(`ignoring invalid pattern ${JSON.stringify(source)}: ${error.message}`);
      }
    }
    const keys = (Array.isArray(raw.exactKeys) ? raw.exactKeys : [])
      .filter((key) => typeof key === 'string' && key.trim().length >= 6)
      // Longest first so overlapping literals cannot mask each other's tail.
      .sort((a, b) => b.length - a.length);
    return { mode: nextMode, extraPatterns: patterns, exactKeys: keys };
  }

  /** Hot-reload detection rules (settings edits) while keeping the id vault.
   *
   * The epoch (and therefore every memoized message) is bumped ONLY when the
   * rules actually changed. A settings save that touches an unrelated field
   * (guardEgress, egressAllowHosts) would otherwise invalidate the whole
   * message cache and force a full O(context) rescan on the next request.
   * The comparison uses the full rule text rather than a hash: a collision
   * here would silently keep a cache built under different rules, which is
   * exactly the missed-credential failure mode we must never allow. */
  function syncRules(raw = {}) {
    const next = buildRules(raw);
    const signature = JSON.stringify({
      mode: next.mode,
      patterns: next.extraPatterns.map((re) => `${re.source}/${re.flags}`),
      exactKeys: next.exactKeys,
    });
    mode = next.mode;
    extraPatterns = next.extraPatterns;
    exactKeys = next.exactKeys;
    if (signature !== rulesSignature) {
      rulesSignature = signature;
      rulesEpoch += 1; // invalidate every memoized message in one step
    }
  }

  syncRules(rawOptions);

  // --- masking ------------------------------------------------------------
  //
  // Returns the same string reference when nothing matched, so callers can
  // detect "unchanged" without comparing contents.
  function maskText(text, usedIds) {
    if (typeof text !== 'string' || text.length === 0) return text;
    perf.stringsScanned += 1;
    let out = text;

    for (const key of exactKeys) {
      if (!out.includes(key)) continue;
      const id = idFor(key);
      usedIds.add(id);
      out = out.split(key).join(placeholderFor(id, mode));
    }

    // Builtins: prefix screen first; the sequential detectors only run on a
    // hit. Sequential, NOT fused — see the BUILTIN_PATTERNS comment: fusion
    // changes pattern-major into position-major and lets one family eat
    // another's prefix, leaking the body in cleartext.
    // (extraPatterns have no knowable prefix, so they always run when set.)
    if (BUILTIN_SCREEN.test(out)) {
      perf.detectorPasses += 1;
      for (const [, pattern] of BUILTIN_PATTERNS) {
        out = out.replace(pattern, (match) => {
          const id = idFor(match);
          usedIds.add(id);
          return placeholderFor(id, mode);
        });
      }
    } else {
      perf.screenSkips += 1;
    }

    for (const re of extraPatterns) {
      perf.detectorPasses += 1;
      out = out.replace(re, (match) => {
        const id = idFor(match);
        usedIds.add(id);
        return placeholderFor(id, mode);
      });
    }

    return out;
  }

  /** Copy-on-write masking of one content block array. Returns the original
   * reference when no block changed. Never mutates input objects. */
  function maskBlocks(blocks, usedIds) {
    if (!Array.isArray(blocks)) return blocks;
    let changed = false;
    const next = blocks.map((block) => {
      if (block === null || typeof block !== 'object') return block;
      if (typeof block.text === 'string' && (block.type === 'text' || block.type === 'reasoning')) {
        const text = maskText(block.text, usedIds);
        if (text !== block.text) {
          changed = true;
          return { ...block, text };
        }
        return block;
      }
      if (block.type === 'tool-call' && typeof block.arguments === 'string') {
        const arguments_ = maskText(block.arguments, usedIds);
        if (arguments_ !== block.arguments) {
          changed = true;
          return { ...block, arguments: arguments_ };
        }
        return block;
      }
      return block;
    });
    return changed ? next : blocks;
  }

  /** Whether a message may be memoized: it must be immutable all the way down
   * to the objects that hold text. A top-level freeze over a still-mutable
   * `content` array — or a frozen array over mutable blocks — could be edited
   * after caching, and serving the cached (clean) form would then be a MISSED
   * CREDENTIAL, not merely a stale view. So a message is cacheable only when
   * the message, its content array, and every content block are frozen. */
  function isCacheableMessage(message) {
    if (!Object.isFrozen(message)) return false;
    const content = message.content;
    if (content === null || typeof content !== 'object') return true; // string content
    if (!Object.isFrozen(content)) return false;
    if (!Array.isArray(content)) return true;
    for (const block of content) {
      if (block !== null && typeof block === 'object' && !Object.isFrozen(block)) return false;
    }
    return true;
  }

  /** Copy-on-write masking of one message. Returns the original reference
   * when nothing changed. Never mutates the input message.
   *
   * Frozen messages (the DSH norm — each session message is deep-frozen once
   * and reused by object identity across requests) are memoized per rules
   * epoch, so re-masking a long context only scans the NEW tail, not the
   * whole history, on every request.
   *
   * The cached masked value is DEEP-FROZEN before being published. It is
   * shared by identity across every later request, so a downstream listener
   * that mutated it in place would poison the cache for the rest of the
   * process — freezing turns that silent corruption into a loud TypeError,
   * matching DSH's own "messages are immutable" contract. */
  function maskMessage(message, usedIds) {
    if (message === null || typeof message !== 'object') return message;

    // Lookup first: a hit implies the message was verified immutable when it
    // was stored, so the warm path costs one WeakMap get per message and never
    // re-walks content blocks.
    const hit = messageCache.get(message);
    if (hit !== undefined && hit.epoch === rulesEpoch) {
      perf.cacheHits += 1;
      for (const id of hit.ids) usedIds.add(id);
      return hit.masked;
    }

    const cacheable = isCacheableMessage(message);

    const local = new Set();
    let masked = message;
    if (Array.isArray(message.content)) {
      const content = maskBlocks(message.content, local);
      if (content !== message.content) masked = deepFreezeValue({ ...message, content });
    } else if (typeof message.content === 'string') {
      const content = maskText(message.content, local);
      if (content !== message.content) masked = deepFreezeValue({ ...message, content });
    }

    if (cacheable) {
      perf.cacheMisses += 1;
      messageCache.set(message, { epoch: rulesEpoch, masked, ids: [...local] });
    }
    for (const id of local) usedIds.add(id);
    return masked;
  }

  /**
   * Mask one outbound request IN PLACE (copy-on-write for every nested
   * value). The llm/stream waterfall hands the same `options` object to the
   * adapter's closure, so replacing whole objects has no effect — only
   * assignment onto `options` reaches the wire.
   *
   * `state` is a WeakMap<options, Set<usedIds>> shared across calls so a
   * retry that reuses the same options object keeps a consistent restore
   * set even though the second pass finds no plaintext keys.
   *
   * Returns the restore set (ids masked into this request across all its
   * passes), or undefined when this request never needed masking.
   */
  function maskRequest(options, state) {
    if (options === null || typeof options !== 'object') return undefined;
    if (Object.isFrozen(options)) return undefined; // caller re-enters with a masked clone
    const startedAt = now();
    try {
      const prior = state.get(options);
      const usedIds = prior ?? new Set();
      let changed = prior !== undefined;

      if (Array.isArray(options.messages)) {
        const masked = options.messages.map((message) => maskMessage(message, usedIds));
        if (masked.some((message, i) => message !== options.messages[i])) {
          options.messages = masked;
          changed = true;
        }
      }

      if (typeof options.system === 'string' && options.system.length > 0) {
        const system = maskText(options.system, usedIds);
        if (system !== options.system) {
          options.system = system;
          changed = true;
        }
      }

      if (!changed) return undefined;
      state.set(options, usedIds);
      perf.requestsMasked += 1;
      return usedIds;
    } finally {
      perf.maskMs += now() - startedAt;
    }
  }

  /**
   * Build a masked, UNFROZEN shallow copy of a request for the frozen-request
   * path: DSH deep-freezes model requests, so when in-place masking is
   * impossible the caller re-enters `llm.stream()` with this clone. Returns
   * null when the request holds nothing to mask.
   */
  function maskRequestClone(options) {
    if (options === null || typeof options !== 'object') return null;
    const startedAt = now();
    try {
      const usedIds = new Set();
      const messages = Array.isArray(options.messages)
        ? options.messages.map((message) => maskMessage(message, usedIds))
        : options.messages;
      const system = typeof options.system === 'string' && options.system.length > 0
        ? maskText(options.system, usedIds)
        : options.system;
      const unchanged = messages === options.messages
        || (Array.isArray(messages) && Array.isArray(options.messages)
          && messages.every((message, i) => message === options.messages[i]));
      if (unchanged && system === options.system) return null;
      const clone = { ...options, messages };
      if (system !== undefined) clone.system = system;
      perf.requestsMasked += 1;
      return { options: clone, usedIds };
    } finally {
      perf.maskMs += now() - startedAt;
    }
  }

  // --- restoration ---------------------------------------------------------

  /** Full-string replacement of complete placeholders. Only ids present in
   * `allowedIds` (i.e. masked into this very request) are restored. */
  function restoreAll(text, allowedIds) {
    if (typeof text !== 'string' || text.indexOf('<<') === -1) return text;
    return text.replace(/<<DSHKEY#(\d{1,5})>>/gi, (whole, digits) => {
      const id = Number(digits);
      if (!allowedIds.has(id)) return whole;
      return keyById.get(id) ?? whole;
    });
  }

  /**
   * Streaming restore with cross-delta holdback: a placeholder may be split
   * across several delta chunks, so any text that could still grow into a
   * placeholder is held back until the next delta or the block's end.
   */
  function makeStreamRestorer(allowedIds) {
    const pending = new Map(); // `${kind}:${index}` -> held-back tail

    function feed(key, text) {
      let buffer = (pending.get(key) ?? '') + text;
      let out = '';
      for (;;) {
        const match = PLACEHOLDER_FULL.exec(buffer);
        if (match) {
          out += buffer.slice(0, match.index);
          const id = Number(match[1]);
          out += allowedIds.has(id) ? keyById.get(id) ?? match[0] : match[0];
          buffer = buffer.slice(match.index + match[0].length);
          continue;
        }
        const hold = holdbackLength(buffer);
        if (hold > 0) {
          out += buffer.slice(0, buffer.length - hold);
          buffer = buffer.slice(buffer.length - hold);
        } else {
          out += buffer;
          buffer = '';
        }
        break;
      }
      pending.set(key, buffer);
      return out;
    }

    function flush(key) {
      const held = pending.get(key) ?? '';
      pending.delete(key);
      return held;
    }

    /** Map one chunk to zero or more chunks. Empty string results from
     * `feed` mean everything was held back; the chunk is dropped and its
     * content re-emitted by a later delta or by the block-end flush. */
    function processChunk(chunk) {
      switch (chunk.type) {
        case 'text-delta': {
          const text = feed(`t:${chunk.index}`, chunk.text);
          return text === '' ? [] : [{ ...chunk, text }];
        }
        case 'reasoning-delta': {
          const text = feed(`r:${chunk.index}`, chunk.text);
          return text === '' ? [] : [{ ...chunk, text }];
        }
        case 'tool-call-delta': {
          const argumentsDelta = feed(`c:${chunk.index}`, chunk.argumentsDelta);
          return argumentsDelta === '' ? [] : [{ ...chunk, argumentsDelta }];
        }
        case 'block-end': {
          const block = chunk.block;
          const chunks = [];
          if (block !== null && typeof block === 'object') {
            // Emit whatever was still held back for this block first, so
            // delta-driven consumers see the complete restored text.
            if (block.type === 'text' || block.type === 'reasoning') {
              const kind = block.type === 'text' ? 't' : 'r';
              const held = flush(`${kind}:${chunk.index}`);
              if (held !== '') {
                chunks.push(
                  block.type === 'text'
                    ? { type: 'text-delta', index: chunk.index, text: held }
                    : { type: 'reasoning-delta', index: chunk.index, text: held },
                );
              }
              const text = restoreAll(block.text, allowedIds);
              chunks.push(text === block.text ? chunk : { ...chunk, block: { ...block, text } });
              return chunks;
            }
            if (block.type === 'tool-call') {
              const held = flush(`c:${chunk.index}`);
              if (held !== '') {
                chunks.push({
                  type: 'tool-call-delta',
                  index: chunk.index,
                  id: block.id,
                  argumentsDelta: held,
                });
              }
              const arguments_ = restoreAll(block.arguments, allowedIds);
              chunks.push(
                arguments_ === block.arguments
                  ? chunk
                  : { ...chunk, block: { ...block, arguments: arguments_ } },
              );
              return chunks;
            }
          }
          return [chunk];
        }
        default:
          return [chunk];
      }
    }

    return { processChunk };
  }

  /**
   * Wrap one model response stream, restoring placeholders masked into the
   * matching request. `allowedIds` is the set returned by maskRequest.
   */
  async function* wrapStream(iterable, allowedIds) {
    const restorer = makeStreamRestorer(allowedIds);
    for await (const chunk of iterable) {
      const startedAt = now();
      const transformed = restorer.processChunk(chunk);
      perf.chunks += 1;
      perf.restoreMs += now() - startedAt;
      // Yield AFTER timestamps are taken: `yield*` suspends across the whole
      // consumer pull, so timing around it would measure consumer/backpressure
      // latency, not the guard's CPU cost.
      yield* transformed;
    }
  }

  return {
    get mode() {
      return mode;
    },
    syncRules,
    maskText,
    maskBlocks,
    maskMessage,
    maskRequest,
    maskRequestClone,
    makeStreamRestorer,
    wrapStream,
    /** Restore every placeholder in `text` that was masked into this egress. */
    restoreAll,
    /** Diagnostics: masked key count, optional id->fingerprint map, and perf
     * counters — scan/screen/cache hit rates and CPU time — so the cost of
     * the guard is observable without a profiler.
     *
     * Fingerprints (first 3 + last 4 chars and the length) are OFF by default:
     * on a short credential they would reveal most of it, and the settings UI
     * has no legitimate need for that. Pass `{ withFingerprints: true }`
     * explicitly when debugging locally. */
    stats(options = {}) {
      const { withFingerprints = false } = options;
      const result = { mode, keys: idByKey.size, perf: { ...perf } };
      if (withFingerprints) {
        const fingerprints = {};
        for (const [id, key] of keyById) {
          fingerprints[id] = `${key.slice(0, 3)}…${key.slice(-4)} (${key.length})`;
        }
        result.fingerprints = fingerprints;
      }
      return result;
    },
  };
}

/** Normalize a raw plugin config row into constructor options. */
export function normalizeConfig(raw) {
  const source = (raw && typeof raw === 'object') ? raw : {};
  return {
    enabled: source.enabled !== false,
    mode: source.mode === 'redact' ? 'redact' : 'placeholder',
    patterns: Array.isArray(source.patterns) ? source.patterns.filter((p) => typeof p === 'string') : [],
    exactKeys: Array.isArray(source.exactKeys)
      ? source.exactKeys.filter((k) => typeof k === 'string' && k.trim().length >= 6)
      : [],
  };
}

export { BUILTIN_PATTERNS, MAX_PLACEHOLDER_CHARS };
