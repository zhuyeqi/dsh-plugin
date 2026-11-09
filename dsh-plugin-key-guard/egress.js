/**
 * key-guard egress guard — mask credentials on the HTTP paths that never pass
 * through `llm/stream`.
 *
 * `llm/stream` covers every model call in this process, but it is not the only
 * way text leaves the machine. Verified leaks in this deployment:
 *
 * - CoT translation (`ctx.translator.translate`) posts reasoning text to
 *   edge.microsoft.com / translate.googleapis.com. It never touches the LLM
 *   pipeline, so `llm/stream` cannot see it.
 * - MCP servers over streamable-http (open.bigmodel.cn) receive tool arguments.
 * - `web_fetch` posts to arbitrary URLs, including loopback and private hosts.
 * - OTLP log exporters POST session events to a telemetry collector.
 *
 * All of them share one primitive: the WHATWG `fetch` in this process, plus
 * `node:http`/`node:https` for exporters that bypass fetch. This module wraps
 * both and masks detected keys in the request BODY and URL.
 *
 * Deliberately NOT masked:
 * - Request headers. `Authorization: Bearer <key>` is how every provider
 *   authenticates; masking it would break each call rather than protect it.
 * - Loopback and private-network destinations. Local flows legitimately carry
 *   credentials end-to-end (saving a key in Settings, the local API gateway),
 *   and nothing leaves the machine.
 */

/** Bodies larger than this are not scanned: a credential is a short token, and
 * scanning multi-megabyte base64 uploads on every fetch is not worth the cost. */
const MAX_SCAN_BYTES = 1024 * 1024;

/** Hosts that are always exempt: traffic never leaves this machine. */
function isLocalHost(host) {
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return true;
  return host.endsWith('.localhost');
}

function hostOf(input) {
  try {
    const raw = typeof input === 'string' ? input : (input && input.url) || String(input);
    // `hostname`, not `host`: `host` carries the port, which would defeat every
    // comparison here (`127.0.0.1:59786` !== `127.0.0.1`).
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function urlOf(input) {
  try {
    return typeof input === 'string' ? input : (input && input.url) || null;
  } catch {
    return null;
  }
}

/**
 * @param {object} options
 * @param {object} options.guard - the key-guard engine from createKeyGuard()
 * @param {string[]|(() => string[])} [options.allowHosts] - extra exempt hostnames
 *   ("api.example.com" or ".example.com"); a function is read per request so
 *   Settings edits apply without a restart
 * @param {() => boolean} [options.enabled] - live master switch
 * @param {(message: string) => void} [options.onWarn]
 */
export function createEgressGuard({ guard, allowHosts = [], enabled = () => true, onWarn = () => {} }) {
  const warned = new Set();
  /** Placeholders masked into **non-LLM** egress, so replies can be restored. */
  const outboundScope = new Set();

  function exemptHosts() {
    const source = typeof allowHosts === 'function' ? allowHosts() : allowHosts;
    const list = Array.isArray(source) ? source : [];
    return list.map((h) => String(h).toLowerCase().replace(/^\./, ''));
  }

  function shouldSkipHost(host) {
    if (host === '') return true; // unparseable: do not risk corrupting it
    if (isLocalHost(host)) return true;
    for (const h of exemptHosts()) {
      if (host === h || host.endsWith(`.${h}`)) return true;
    }
    return false;
  }

  /** True when this request must pass through untouched. */
  function bypass(host) {
    try {
      if (!enabled()) return true;
    } catch {
      return true;
    }
    return shouldSkipHost(host);
  }

  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    onWarn(message);
  }

  function maskScan(text, usedIds) {
    if (typeof text !== 'string' || text.length === 0) return text;
    if (text.length > MAX_SCAN_BYTES) {
      warnOnce('oversize', `egress: skipped masking a ${text.length}-byte body (over ${MAX_SCAN_BYTES} bytes)`);
      return text;
    }
    return guard.maskText(text, usedIds);
  }

  /** Mask one request body. Returns the original reference when unchanged. */
  function maskBody(body, usedIds) {
    if (typeof body === 'string') return maskScan(body, usedIds);
    if (body instanceof URLSearchParams) {
      const source = body.toString();
      const masked = maskScan(source, usedIds);
      return masked === source ? body : new URLSearchParams(masked);
    }
    // Blob / FormData / ReadableStream / ArrayBuffer: not scanned.
    return body;
  }

  // ---- fetch ---------------------------------------------------------------
  let originalFetch = null;

  async function guardedFetch(input, init) {
    const url = urlOf(input);
    const host = hostOf(input);
    if (bypass(host)) return originalFetch(input, init);

    const usedIds = new Set();
    let nextInput = input;
    let nextInit = init;

    // URL: a credential in a query string is still a credential on the wire.
    if (typeof url === 'string') {
      const maskedUrl = maskScan(url, usedIds);
      if (maskedUrl !== url) {
        nextInput = typeof input === 'string' ? maskedUrl : new Request(maskedUrl, input);
        warnOnce(`url:${host}`, `egress: masked a credential in the request URL sent to ${host}`);
      }
    }

    const body = nextInit === undefined || nextInit === null ? undefined : nextInit.body;
    if (body !== undefined && body !== null) {
      const masked = maskBody(body, usedIds);
      if (masked !== body) {
        nextInit = { ...nextInit, body: masked };
        warnOnce(`body:${host}`, `egress: masked ${usedIds.size} credential(s) in a request body sent to ${host}`);
      }
    }

    if (usedIds.size > 0) for (const id of usedIds) outboundScope.add(id);
    return originalFetch(nextInput, nextInit);
  }

  // ---- node:http / node:https ---------------------------------------------
  // OTLP log exporters and some SDKs bypass fetch. Patch the payload writers.
  const patchedModules = [];
  const builtinPatched = [];

  function patchHttpModule(namespace) {
    // `import('node:http')` yields a Module Namespace whose properties are
    // read-only AND whose assignment is a silent no-op — patching it does
    // nothing at all. The mutable CommonJS module object is `.default`.
    const module = namespace.default ?? namespace;
    const originalRequest = module.request;
    const originalGet = module.get;

    function wrapRequest(original) {
      return function patched(...args) {
        const req = original.apply(this, args);
        try {
          const host = String((req && req.host) || (req && req.hostname) || '');
          if (bypass(host.toLowerCase())) return req;
          for (const method of ['write', 'end']) {
            const originalWriter = req[method];
            if (typeof originalWriter !== 'function') continue;
            req[method] = function guardedWriter(...writerArgs) {
              const chunk = writerArgs[0];
              if (typeof chunk === 'string') {
                const usedIds = new Set();
                const masked = maskScan(chunk, usedIds);
                if (masked !== chunk) {
                  usedIds.forEach((id) => outboundScope.add(id));
                  warnOnce(`http:${host}`, `egress: masked a credential in an http body sent to ${host}`);
                  return originalWriter.call(this, masked, ...writerArgs.slice(1));
                }
              }
              return originalWriter.apply(this, writerArgs);
            };
          }
        } catch {
          // Never break the caller's request over guard plumbing.
        }
        return req;
      };
    }

    module.request = wrapRequest(originalRequest);
    module.get = wrapRequest(originalGet);
    patchedModules.push(() => {
      module.request = originalRequest;
      module.get = originalGet;
    });
    builtinPatched.push(module);
  }

  /**
   * Builtin ESM named exports are snapshotted at first evaluation, so patching
   * the CommonJS module object is invisible to `import('node:http')` consumers.
   * The OTLP log exporter does exactly `const { request } = await import('http')`,
   * so without this the telemetry exporter would keep the original function.
   *
   * `syncBuiltinESMExports()` is the supported way to push CJS mutations back
   * into those named exports.
   */
  async function syncBuiltins() {
    if (builtinPatched.length === 0) return;
    try {
      const module = await import('node:module');
      if (typeof module.syncBuiltinESMExports === 'function') module.syncBuiltinESMExports();
    } catch {
      onWarn('egress: syncBuiltinESMExports unavailable; node:http consumers may bypass the guard');
    }
  }

  let installed = false;

  return {
    get installed() {
      return installed;
    },
    /** Placeholder ids masked into non-LLM egress during this process. */
    maskedIds() {
      return new Set(outboundScope);
    },
    /** Shared host policy: true when a host is local (always) or explicitly exempt. */
    isLocalOrExempt(host) {
      return shouldSkipHost(String(host || '').toLowerCase());
    },
    async install() {
      if (installed) return;
      installed = true;
      if (typeof globalThis.fetch === 'function') {
        originalFetch = globalThis.fetch;
        globalThis.fetch = guardedFetch;
      }
      for (const specifier of ['node:http', 'node:https']) {
        try {
          const namespace = await import(specifier);
          // A concurrent uninstall() may have run during the await above.
          if (!installed) return;
          patchHttpModule(namespace);
        } catch {
          // Module unavailable in this runtime: fetch guard still applies.
        }
      }
      await syncBuiltins();
    },
    uninstall() {
      if (!installed) return;
      installed = false;
      if (originalFetch !== null) {
        globalThis.fetch = originalFetch;
        originalFetch = null;
      }
      for (const restore of patchedModules.splice(0)) restore();
      builtinPatched.length = 0;
      // Fire-and-forget: teardown is synchronous, and a stale named export only
      // matters if the plugin is unloaded, in which case nothing calls it again.
      void syncBuiltins();
    },
  };
}
