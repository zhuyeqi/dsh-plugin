/**
 * key-guard boundary guards — non-LLM services that carry text off this machine.
 *
 * The CoT ("thinking") translator is the sharpest case: DSH translates the
 * model's reasoning into the reader's language, so it posts **reasoning text**
 * to Microsoft's Edge endpoint (`edge.microsoft.com/translate/translatetext`)
 * or Google's anonymous endpoint. Reasoning routinely quotes user content, so a
 * credential mentioned anywhere in a turn can ride along. That traffic never
 * touches `llm/stream`, which is why the waterfall hook alone cannot cover it.
 *
 * The service is reachable as `ctx.translator`, a cordis Service with a
 * `translate(spec, signal)` method. Wrapping that method masks `spec.text`
 * before the request is built, and restores the placeholder in the returned
 * translation so the reader still sees the real value.
 *
 * A useful side effect: DSH records `plugin:translator/request` from the same
 * `spec`, so the Session log stores the placeholder instead of the key.
 */

/**
 * @param {object} ctx - the plugin context
 * @param {object} options
 * @param {object} options.guard - key-guard engine
 * @param {() => {enabled: boolean, guardTranslator: boolean}} options.readRules
 * @param {(message: string) => void} [options.onWarn]
 * @returns {() => void} teardown
 */
export function installTranslatorGuard(ctx, { guard, readRules, onWarn = () => {} }) {
  let disposed = false;

  const off = ctx.inject(['translator'], (child) => {
    child.effect(() => {
      const service = child.translator;
      if (service === undefined || service === null) return;
      if (typeof service.translate !== 'function') {
        onWarn('translator guard: ctx.translator has no translate() method; CoT translation is unguarded');
        return;
      }
      if (service.translate.__keyGuardWrapped === true) return;

      const original = service.translate;

      async function guardedTranslate(spec, signal) {
        let rules;
        try {
          rules = readRules();
        } catch {
          rules = { enabled: true, guardTranslator: true };
        }
        if (!rules.enabled || !rules.guardTranslator) return original.call(this, spec, signal);
        if (spec === null || typeof spec !== 'object' || typeof spec.text !== 'string') {
          return original.call(this, spec, signal);
        }

        const usedIds = new Set();
        const masked = guard.maskText(spec.text, usedIds);
        if (masked === spec.text) return original.call(this, spec, signal);

        const translated = await original.call(this, { ...spec, text: masked }, signal);
        // Restore so the reader's pane shows the credential, not a placeholder.
        return typeof translated === 'string' ? guard.restoreAll(translated, usedIds) : translated;
      }

      Object.defineProperty(guardedTranslate, '__keyGuardWrapped', { value: true });

      try {
        service.translate = guardedTranslate;
      } catch {
        onWarn('translator guard: ctx.translator.translate is read-only; CoT translation is unguarded');
        return;
      }

      return () => {
        try {
          if (service.translate === guardedTranslate) service.translate = original;
        } catch {
          // Teardown must never throw.
        }
      };
    }, 'key-guard: translator egress');
  });

  return () => {
    if (disposed) return;
    disposed = true;
    try {
      off();
    } catch {
      // Teardown must never throw.
    }
  };
}

/**
 * Guard the gap the fetch patch cannot close.
 *
 * `web_fetch` reaches the network through `await import('undici')` and
 * destructures `fetch` from that module namespace. Builtin/undici ESM named
 * exports are not patchable (`Object.defineProperty` on the namespace throws,
 * and `syncBuiltinESMExports` only covers node builtins), so a fetch wrapper
 * never sees it.
 *
 * `tools/pre-execute` cannot rewrite arguments either — it only returns a gate.
 * So the available, and correct, control is to refuse: if a tool call is about
 * to put a real credential into a URL aimed at a remote host, deny it and tell
 * the model why.
 *
 * Scoped deliberately narrow:
 * - only URL-shaped argument fields (`url`, `uri`, `endpoint`, `webUrl`, …)
 * - only remote, non-exempt hosts
 * - only when a credential actually matches a detector
 * Anything else (bash, file writes, local endpoints) passes untouched, because
 * those legitimately carry credentials end-to-end.
 */

const URL_FIELDS = ['url', 'uri', 'endpoint', 'weburl', 'targeturl', 'href'];

function collectUrls(value, out, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 4) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out, depth + 1);
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && URL_FIELDS.includes(key.toLowerCase())) {
      out.push(item);
    } else if (typeof item === 'object') {
      collectUrls(item, out, depth + 1);
    }
  }
  return out;
}

/**
 * @param {object} ctx - plugin context
 * @param {object} options
 * @param {object} options.guard - key-guard engine
 * @param {() => {enabled: boolean, guardToolUrls: boolean, egressAllowHosts: string[]}} options.readRules
 * @param {boolean} options.isLocalOrExempt - host predicate shared with the egress guard
 * @param {(message: string) => void} [options.onWarn]
 * @returns {() => void} teardown
 */
export function installToolUrlGuard(ctx, { guard, readRules, isLocalOrExempt, onWarn = () => {} }) {
  let denied = 0;

  const off = ctx.on(
    'tools/pre-execute',
    (exec, next) => {
      let rules;
      try {
        rules = readRules();
      } catch {
        return next();
      }
      if (!rules.enabled || !rules.guardToolUrls) return next();

      const urls = collectUrls(exec?.arguments, []);
      if (urls.length === 0) return next();

      for (const raw of urls) {
        let host = '';
        try {
          host = new URL(raw).hostname.toLowerCase();
        } catch {
          continue; // not an absolute URL: nothing can leave the machine
        }
        if (host === '' || isLocalOrExempt(host)) continue;

        const usedIds = new Set();
        const masked = guard.maskText(raw, usedIds);
        if (masked === raw || usedIds.size === 0) continue;

        denied += 1;
        onWarn(
          `tool-url guard: refused "${exec.name}" — a credential was about to be sent to ${host} in a URL`,
        );
        return Promise.resolve({
          kind: 'deny',
          reason:
            `key-guard: this call would send a credential to ${host} inside a URL. ` +
            'URIs and query strings are logged by intermediaries and servers, so a key must not travel there. ' +
            'Do not retry with the key in the URL; tell the user which value was needed and why the call was blocked.',
        });
      }

      return next();
    },
    { global: true },
  );

  return () => {
    try {
      off();
      if (denied > 0) onWarn(`tool-url guard: blocked ${denied} call(s) carrying a credential in a URL`);
    } catch {
      // Teardown must never throw.
    }
  };
}
