/**
 * key-guard — keep model/AI credentials on this machine.
 *
 * Hooks the `llm/stream` waterfall, which wraps EVERY model call in this
 * process (agent steps, subagents, compaction, titles, retries, replays):
 *
 * - outbound: any credential detected in `options.messages` / `options.system`
 *   is masked as `<<DSHKEY#n>>`. DSH deep-freezes requests, so masking uses
 *   two paths: in-place copy-on-write mutation when possible, and otherwise a
 *   re-entry — a masked, unfrozen clone sent through `llm.stream()` again,
 *   which re-runs the full waterfall (this listener passes it through since
 *   the clone carries no plaintext keys).
 * - inbound: placeholders the model echoes back — in text, reasoning, or
 *   tool-call arguments, even split across stream deltas — are restored to
 *   the real key, so local tool execution sees working credentials while
 *   the provider only ever saw the placeholder.
 *
 * Every rule is a volatile Config field, so the Settings page edits them
 * live (no restart): `settings/document-updated` refreshes the detectors and
 * the `enabled` switch is read per request.
 */

import z from '@deepseek-ai/schemastery';
import { createKeyGuard } from './engine.js';
import { createEgressGuard } from './egress.js';
import { installTranslatorGuard, installToolUrlGuard } from './boundaries.js';

export const name = 'key-guard';

export const Config = z.object({
  enabled: z.boolean().default(true).volatile()
    .description('master switch; effective immediately (生效开关，免重启)'),
  mode: z.union([
    z.const('placeholder').description('placeholder, restored on reply (占位符，返回时本地还原)'),
    z.const('redact').description('permanent redaction (永久遮蔽，不还原)'),
  ]).default('placeholder').volatile().description('masking mode (脱敏模式)'),
  patterns: z.array(z.string()).default([]).volatile()
    .description('extra regex sources, case-insensitive (自定义正则，忽略大小写)'),
  exactKeys: z.array(z.string().role('secret')).default([]).volatile()
    .description('literal secrets always masked verbatim (精确密钥，写入后不回显)'),
  guardEgress: z.boolean().default(true).volatile()
    .description('mask keys in non-LLM HTTP bodies/URLs: MCP, web_fetch, telemetry (出口守卫：MCP/web_fetch/遥测)'),
  guardTranslator: z.boolean().default(true).volatile()
    .description('mask keys before CoT translation leaves the machine (思维链翻译脱敏)'),
  guardToolUrls: z.boolean().default(true).volatile()
    .description('refuse tool calls that put a key into a remote URL, e.g. web_fetch (工具 URL 守卫)'),
  egressAllowHosts: z.array(z.string()).default([]).volatile()
    .description('extra hosts exempt from the egress guard (豁免主机；环回地址始终豁免)'),
});

/** Read a volatile (or plain) config field's current value. */
function liveRead(field, fallback) {
  if (field !== null && typeof field === 'object' && typeof field.get === 'function') {
    try {
      const value = field.get();
      return value === undefined || value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }
  return field === undefined || field === null ? fallback : field;
}

export function apply(ctx, config) {
  const readRules = () => ({
    enabled: liveRead(config?.enabled, true) !== false,
    mode: liveRead(config?.mode, 'placeholder') === 'redact' ? 'redact' : 'placeholder',
    patterns: liveRead(config?.patterns, []),
    exactKeys: liveRead(config?.exactKeys, []),
    guardEgress: liveRead(config?.guardEgress, true) !== false,
    guardTranslator: liveRead(config?.guardTranslator, true) !== false,
    guardToolUrls: liveRead(config?.guardToolUrls, true) !== false,
    egressAllowHosts: liveRead(config?.egressAllowHosts, []),
  });

  const guard = createKeyGuard({
    ...readRules(),
    onConfigWarning: (message) => ctx.logger.warn(`key-guard: ${message}`),
  });

  // Settings edits land live: refresh the detectors, keep the id vault.
  ctx.on('settings/document-updated', (ns) => {
    if (ns !== 'key-guard') return;
    guard.syncRules(readRules());
    ctx.logger.info(`key-guard: rules refreshed from settings (${guard.mode} mode)`);
  });

  // options object -> ids masked into it, surviving retries that reuse it
  const requestState = new WeakMap();
  let maskedRequests = 0;

  // ---- boundaries that never reach `llm/stream` ----------------------------
  //
  // `llm/stream` covers every model call, but text also leaves through other
  // services: CoT translation (Microsoft/Google), MCP servers, web_fetch and
  // OTLP exporters. Both guards below are togglable live from Settings.

  installTranslatorGuard(ctx, {
    guard,
    readRules,
    onWarn: (message) => ctx.logger.warn(`key-guard: ${message}`),
  });

  // `allowHosts` is read at call time, so Settings edits apply without restart.
  const egress = createEgressGuard({
    guard,
    allowHosts: () => {
      const hosts = readRules().egressAllowHosts;
      return Array.isArray(hosts) ? hosts : [];
    },
    enabled: () => readRules().enabled && readRules().guardEgress,
    onWarn: (message) => ctx.logger.warn(`key-guard: ${message}`),
  });

  ctx.effect(() => {
    let active = true;
    void egress.install().then(() => {
      if (!active) egress.uninstall();
    });
    return () => {
      active = false;
      egress.uninstall();
    };
  }, 'key-guard: egress guard');

  // web_fetch bypasses the fetch patch (undici namespace is not patchable), so
  // the only control left is refusing the call at the tool gate.
  installToolUrlGuard(ctx, {
    guard,
    readRules,
    isLocalOrExempt: (host) => egress.isLocalOrExempt(host),
    onWarn: (message) => ctx.logger.warn(`key-guard: ${message}`),
  });

  // Registered with `prepend` so key-guard is the OUTERMOST listener: the
  // frozen-request re-entry (llm.stream below) re-runs the waterfall, and
  // every listener positioned above key-guard would otherwise run twice per
  // masked request — session checkpointing (a disk flush) and title
  // bookkeeping included. Outermost, the outer pass stops here and the
  // re-entered pass runs everything exactly once. Downstream listeners then
  // observe masked options, which is also the privacy-safer side to err on.
  ctx.on(
    'llm/stream',
    (options, next) => {
      if (!readRules().enabled) return next(); // hot on/off switch

      // Path 1: mutate the request in place (copy-on-write per nested value).
      const allowedIds = guard.maskRequest(options, requestState);
      if (allowedIds !== undefined) {
        maskedRequests += 1;
        return guard.wrapStream(next(), allowedIds);
      }

      // Path 2 exists solely for FROZEN requests (the DSH norm): maskRequest
      // cannot assign onto a frozen object, so clone, mask, and re-enter the
      // waterfall. An unfrozen request that reaches here was already scanned
      // whole and found clean — cloning it would only re-scan it for nothing.
      if (!Object.isFrozen(options)) return next();

      const clone = guard.maskRequestClone(options);
      if (clone === null) return next();

      const llm = ctx.get('llm');
      if (llm === undefined || typeof llm.stream !== 'function') {
        ctx.logger.error('key-guard: llm service unavailable; a request with credentials proceeds unmasked');
        return next();
      }

      maskedRequests += 1;
      const route = `${options.provider ?? '?'}:${options.model ?? '?'}`;
      ctx.logger.info(
        `key-guard: masked ${clone.usedIds.size} key(s) into ${route} (re-entry); placeholders in the reply will be restored locally`,
      );
      return guard.wrapStream(llm.stream(clone.options), clone.usedIds);
    },
    { global: true, prepend: true },
  );

  ctx.effect(() => () => {
    const { perf } = guard.stats();
    ctx.logger.info(
      `key-guard: stopped after masking ${maskedRequests} request(s) `
      + `(${perf.stringsScanned} strings scanned, ${perf.screenSkips} screen-skipped, `
      + `${perf.cacheHits}/${perf.cacheHits + perf.cacheMisses} message-cache hits, `
      + `mask ${perf.maskMs.toFixed(1)}ms / restore ${perf.restoreMs.toFixed(1)}ms)`,
    );
  });

  // Tell the model what the placeholders mean, so it references them like the
  // real credentials instead of stopping to ask. The example deliberately uses
  // a non-numeric id ("#n") so the restore matcher can never touch it.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({
      name: 'key-guard-placeholders',
      order: 150,
      text: [
        'A local security layer masks API and model keys in this conversation:',
        'every token of the form <<DSHKEY#n>> stands for one real credential that',
        'never left this machine. Treat each placeholder as the credential itself:',
        'copy it verbatim wherever the real key is needed (commands, config files,',
        'HTTP requests) — the harness substitutes the real value locally before',
        'anything runs, so there is no need to ask the user to reveal or retype',
        'the key, and no need to comment on the masking.',
      ].join(' '),
    }), 'key-guard: placeholder hint section');
  });

  ctx.logger.info(
    `key-guard: active (${guard.mode} mode) — outbound masking on, inbound restore ${guard.mode === 'redact' ? 'off' : 'on'}`,
  );
}
