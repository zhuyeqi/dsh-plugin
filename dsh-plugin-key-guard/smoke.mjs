/**
 * key-guard smoke tests — run with: node smoke.mjs
 * No dependencies; exercises the pure engine end-to-end including a
 * simulated llm/stream waterfall round trip.
 */
import assert from 'node:assert/strict';
import { createKeyGuard, normalizeConfig } from './engine.js';

const REAL_KEY = 'sk-abc123def456ghi789jkl012mno';
const REAL_KEY_2 = 'sk-ant-api03-9ZxY8vUtSrQpOnMlKjIhGfEdCbA987654321';
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';

function request(messages, system) {
  return { provider: 'deepseek', model: 'chat', messages, system };
}

async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

async function main() {
  // ---- 1. outbound masking -------------------------------------------------
  {
    const guard = createKeyGuard({});
    const userMsg = { role: 'user', id: 'u1', content: [{ type: 'text', text: `call the API with ${REAL_KEY} please` }] };
    const originalText = userMsg.content[0].text;
    const req = request([userMsg], `You may see ${REAL_KEY_2} in context.`);
    const state = new WeakMap();
    const allowed = guard.maskRequest(req, state);

    assert.ok(allowed, 'maskRequest reports a restore set when keys were found');
    assert.ok(!JSON.stringify(req).includes(REAL_KEY), 'real sk- key never appears in masked request');
    assert.ok(!JSON.stringify(req).includes(REAL_KEY_2), 'anthropic key never appears in masked request');
    assert.match(req.messages[0].content[0].text, /<<DSHKEY#\d+>>/);
    assert.match(req.system, /<<DSHKEY#\d+>>/);
    assert.equal(userMsg.content[0].text, originalText, 'original message object is never mutated');
    console.log('1. outbound masking: ok');
  }

  // ---- 2. inbound restore, whole placeholder -------------------------------
  {
    const guard = createKeyGuard({});
    const req = request([{ role: 'user', content: [{ type: 'text', text: `use ${REAL_KEY}` }] }]);
    const allowed = guard.maskRequest(req, new WeakMap());
    const ph = req.messages[0].content[0].text.match(/<<DSHKEY#\d+>>/)[0];

    const chunks = await collect(guard.wrapStream([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'export KEY=' },
      { type: 'text-delta', index: 0, text: ph },
      { type: 'block-end', index: 0, block: { type: 'text', text: `export KEY=${ph}` } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], allowed));

    assert.equal(chunks[2].text, REAL_KEY, 'delta with a complete placeholder is restored');
    assert.equal(chunks[3].block.text, `export KEY=${REAL_KEY}`, 'block-end authoritative text is restored');
    console.log('2. inbound restore (complete placeholder): ok');
  }

  // ---- 3. placeholder split across deltas ----------------------------------
  {
    const guard = createKeyGuard({});
    const req = request([{ role: 'user', content: [{ type: 'text', text: `use ${REAL_KEY}` }] }]);
    const allowed = guard.maskRequest(req, new WeakMap());
    const ph = req.messages[0].content[0].text.match(/<<DSHKEY#\d+>>/)[0];
    const [a, b, c] = [ph.slice(0, 5), ph.slice(5, 9), ph.slice(9)];

    const chunks = await collect(guard.wrapStream([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'key: ' },
      { type: 'text-delta', index: 0, text: a },
      { type: 'text-delta', index: 0, text: b },
      { type: 'text-delta', index: 0, text: c },
      { type: 'block-end', index: 0, block: { type: 'text', text: `key: ${ph}` } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], allowed));

    const streamed = chunks.filter((ch) => ch.type === 'text-delta').map((ch) => ch.text).join('');
    assert.equal(streamed, `key: ${REAL_KEY}`, 'split placeholder is held back and restored');
    assert.equal(chunks.at(-2).block.text, `key: ${REAL_KEY}`);
    console.log('3. split-delta restore: ok');
  }

  // ---- 4. tool-call arguments restore --------------------------------------
  {
    const guard = createKeyGuard({});
    const req = request([{ role: 'user', content: [{ type: 'text', text: `curl with ${REAL_KEY}` }] }]);
    const allowed = guard.maskRequest(req, new WeakMap());
    const ph = req.messages[0].content[0].text.match(/<<DSHKEY#\d+>>/)[0];
    const args = `{"command":"curl -H 'Authorization: Bearer ${ph}' https://api.example.com/v1"}`;

    const chunks = await collect(guard.wrapStream([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'bash', argumentsDelta: args.slice(0, 30) },
      { type: 'tool-call-delta', index: 0, id: 'call_1', argumentsDelta: args.slice(30) },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_1', name: 'bash', arguments: args } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ], allowed));

    const joined = chunks.filter((ch) => ch.type === 'tool-call-delta').map((ch) => ch.argumentsDelta).join('');
    assert.equal(joined, args.replace(ph, REAL_KEY), 'tool-call deltas restore across the split');
    assert.ok(chunks.at(-2).block.arguments.includes(REAL_KEY), 'block-end tool arguments restored');
    assert.ok(!chunks.at(-2).block.arguments.includes('<<DSHKEY'), 'no placeholder survives');
    console.log('4. tool-call restore: ok');
  }

  // ---- 5. unknown ids are never restored -----------------------------------
  {
    const guard = createKeyGuard({});
    const req = request([{ role: 'user', content: [{ type: 'text', text: `use ${REAL_KEY}` }] }]);
    const allowed = guard.maskRequest(req, new WeakMap());
    const guessed = '<<DSHKEY#999>>';

    const chunks = await collect(guard.wrapStream([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: guessed },
      { type: 'block-end', index: 0, block: { type: 'text', text: guessed } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], allowed));

    assert.equal(chunks[1].text, guessed, 'placeholder ids never sent stay opaque');
    console.log('5. probe resistance: ok');
  }

  // ---- 6. retry with the same options object -------------------------------
  {
    const guard = createKeyGuard({});
    const req = request([{ role: 'user', content: [{ type: 'text', text: `use ${REAL_KEY}` }] }]);
    const state = new WeakMap();
    const first = guard.maskRequest(req, state);
    const second = guard.maskRequest(req, state); // retry: already masked

    assert.ok(second, 'retry still yields a restore set');
    assert.deepEqual([...second].sort(), [...first].sort(), 'restore set survives retries');

    const ph = req.messages[0].content[0].text.match(/<<DSHKEY#\d+>>/)[0];
    const chunks = await collect(guard.wrapStream([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: ph },
      { type: 'block-end', index: 0, block: { type: 'text', text: ph } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], second));
    assert.equal(chunks[2].block.text, REAL_KEY, 'retry reply is still restored');
    console.log('6. retry idempotency: ok');
  }

  // ---- 7. redact mode -------------------------------------------------------
  {
    const guard = createKeyGuard({ mode: 'redact' });
    const req = request([{ role: 'user', content: [{ type: 'text', text: `use ${REAL_KEY}` }] }]);
    const allowed = guard.maskRequest(req, new WeakMap());
    assert.equal(req.messages[0].content[0].text, 'use <<REDACTED>>', 'redact mode replaces with a constant');

    const chunks = await collect(guard.wrapStream([
      { type: 'block-end', index: 0, block: { type: 'text', text: 'use <<REDACTED>>' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], allowed));
    assert.equal(chunks[0].block.text, 'use <<REDACTED>>', 'redact mode never restores');
    console.log('7. redact mode: ok');
  }

  // ---- 8. exactKeys + extra patterns ---------------------------------------
  {
    const guard = createKeyGuard({ exactKeys: ['gateway-internal-token-42'], patterns: ['TEAM_\\d{2}_[A-F0-9]{8}'] });
    const text = 'tokens: gateway-internal-token-42 and TEAM_07_AB12CD34 and sk-clean-none-here';
    const req = request([{ role: 'user', content: [{ type: 'text', text }] }]);
    guard.maskRequest(req, new WeakMap());
    const masked = req.messages[0].content[0].text;
    assert.ok(!masked.includes('gateway-internal-token-42'), 'exact literal masked');
    assert.ok(!masked.includes('TEAM_07_AB12CD34'), 'custom pattern masked');
    assert.ok(masked.includes('sk-clean-none-here'), 'sk- below length threshold untouched');
    console.log('8. exactKeys + patterns: ok');
  }

  // ---- 9. stable ids, AWS pattern, no-key passthrough -----------------------
  {
    const guard = createKeyGuard({});
    const r1 = request([{ role: 'user', content: [{ type: 'text', text: `${REAL_KEY} ${AWS_KEY}` }] }]);
    guard.maskRequest(r1, new WeakMap());
    const r2 = request([{ role: 'user', content: [{ type: 'text', text: `again ${REAL_KEY}` }] }]);
    guard.maskRequest(r2, new WeakMap());
    const p1 = r1.messages[0].content[0].text;
    const p2 = r2.messages[0].content[0].text;
    assert.match(p1, /AKIA[0-9A-Z]{16}/.test(AWS_KEY) && /<<DSHKEY#\d+>>.*<<DSHKEY#\d+>>/, 'both keys masked');
    const id1 = p1.match(/<<DSHKEY#(\d+)>>/)[1];
    const id2 = p2.match(/<<DSHKEY#(\d+)>>/)[1];
    assert.equal(id1, id2, 'same key keeps a stable id across requests');

    const clean = request([{ role: 'user', content: [{ type: 'text', text: 'nothing secret here' }] }]);
    assert.equal(guard.maskRequest(clean, new WeakMap()), undefined, 'clean request reports nothing to restore');
    assert.equal(clean.messages[0].content[0].text, 'nothing secret here');
    console.log('9. stable ids + passthrough: ok');
  }

  // ---- 10. normalizeConfig ---------------------------------------------------
  {
    const cfg = normalizeConfig({ enabled: false, mode: 'redact', patterns: ['a('], exactKeys: ['short', 'valid-secret-1'] });
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.mode, 'redact');
    assert.deepEqual(cfg.exactKeys, ['valid-secret-1'], 'too-short exact key dropped');
    const guard = createKeyGuard(cfg); // invalid regex must not throw
    console.log('10. config normalization: ok');
  }

  // ---- 11. stats never leak key material -------------------------------------
  {
    const guard = createKeyGuard({});
    guard.maskText(`x ${REAL_KEY} y`, new Set());
    const json = JSON.stringify(guard.stats());
    assert.ok(!json.includes(REAL_KEY), 'stats expose fingerprints only');
    console.log('11. safe stats: ok');
  }

  // ---- 12. frozen request -> masked clone path -------------------------------
  {
    const guard = createKeyGuard({});
    const userMsg = Object.freeze({ role: 'user', content: Object.freeze([{ type: 'text', text: `use ${REAL_KEY}` }]) });
    const frozen = Object.freeze({ provider: 'p', model: 'm', messages: Object.freeze([userMsg]), system: `secret ${AWS_KEY}` });

    assert.equal(guard.maskRequest(frozen, new WeakMap()), undefined, 'frozen request defers to the clone path');

    const clone = guard.maskRequestClone(frozen);
    assert.ok(clone, 'clone path produces a masked copy');
    assert.ok(!Object.isFrozen(clone.options), 'clone is unfrozen for downstream mutation');
    assert.ok(!JSON.stringify(clone.options).includes(REAL_KEY), 'clone carries no plaintext key');
    assert.ok(!JSON.stringify(clone.options).includes(AWS_KEY), 'clone masks the system prompt too');
    assert.match(clone.options.messages[0].content[0].text, /<<DSHKEY#\d+>>/);
    assert.equal(frozen.messages[0].content[0].text, `use ${REAL_KEY}`, 'frozen original is untouched');
    assert.deepEqual(JSON.stringify(clone.options.messages).length > 0 && [clone.options.provider, clone.options.model], ['p', 'm'], 'clone keeps request config');

    // The re-entered clone must pass through maskRequest untouched (no re-masking loop)
    const state = new WeakMap();
    assert.equal(guard.maskRequest(clone.options, state), undefined, 'masked clone passes through on re-entry');
    assert.equal(guard.maskRequestClone(clone.options), null, 'masked clone needs no second clone');

    // And the reply to the clone still restores
    const ph = clone.options.messages[0].content[0].text.match(/<<DSHKEY#\d+>>/)[0];
    const chunks = await collect(guard.wrapStream([
      { type: 'block-end', index: 0, block: { type: 'text', text: ph } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], clone.usedIds));
    assert.equal(chunks[0].block.text, REAL_KEY, 'clone reply restores');

    const clean = Object.freeze({ provider: 'p', model: 'm', messages: Object.freeze([{ role: 'user', content: [{ type: 'text', text: 'clean' }] }]) });
    assert.equal(guard.maskRequestClone(clean), null, 'clean frozen request needs no clone');
    console.log('12. frozen request clone path: ok');
  }

  // ---- 13. hot rule reload keeps the vault stable -----------------------------
  {
    const guard = createKeyGuard({});
    const req1 = request([{ role: 'user', content: [{ type: 'text', text: `use ${REAL_KEY}` }] }]);
    guard.maskRequest(req1, new WeakMap());
    const id1 = Number(req1.messages[0].content[0].text.match(/<<DSHKEY#(\d+)>>/)[1]);

    // Settings edit adds a custom pattern: next request picks it up with the
    // same id numbering (vault untouched), previously unknown ids still restore.
    guard.syncRules({ mode: 'placeholder', patterns: ['TEAM_\\d{2}_[A-F0-9]{8}'] });
    const req2 = request([{ role: 'user', content: [{ type: 'text', text: `again ${REAL_KEY} and TEAM_07_AB12CD34` }] }]);
    const allowed = guard.maskRequest(req2, new WeakMap());
    const masked2 = req2.messages[0].content[0].text;
    assert.ok(!masked2.includes('TEAM_07_AB12CD34'), 'reloaded rule masks new pattern');
    assert.ok(!masked2.includes(REAL_KEY), 'builtin rules still active after reload');
    assert.equal(Number(masked2.match(/<<DSHKEY#(\d+)>>/)[1]), id1, 'same key keeps its id across reloads');
    assert.ok(allowed.has(id1), 'restore set carries the surviving id');
    console.log('13. hot rule reload: ok');
  }

  // ---- 14. engine mode switch via syncRules -----------------------------------
  {
    const guard = createKeyGuard({ mode: 'placeholder' });
    const r1 = request([{ role: 'user', content: [{ type: 'text', text: `use ${REAL_KEY}` }] }]);
    guard.maskRequest(r1, new WeakMap());
    guard.syncRules({ mode: 'redact' });
    assert.equal(guard.mode, 'redact', 'mode getter reflects reload');
    const r2 = request([{ role: 'user', content: [{ type: 'text', text: `use ${REAL_KEY}` }] }]);
    guard.maskRequest(r2, new WeakMap());
    assert.equal(r2.messages[0].content[0].text, 'use <<REDACTED>>', 'mode switch applies to later requests');
    console.log('14. mode switch via syncRules: ok');
  }

  console.log('\nkey-guard smoke: all 14 groups passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
