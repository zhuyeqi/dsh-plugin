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

      // Path 2: nothing detected, or a frozen request. Frozen requests are
      // the DSH norm — clone, mask, and re-enter the waterfall so every other
      // middleware (retry, validation, routing) still sees a real stream.
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
    { global: true },
  );

  ctx.effect(() => () => {
    ctx.logger.info(`key-guard: stopped after masking ${maskedRequests} request(s)`);
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
