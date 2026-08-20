// Live check for the derived-analytics pipeline (not part of smoke.mjs; hits real upstreams).
// Loads the built bundle and pulls createQuoteCnService out of its module scope via a small eval shim.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
if (!src.includes('async fetchDerived') && !src.includes('fetchDerived')) {
  console.error('FAIL: fetchDerived missing from bundle');
  process.exit(1);
}
// Append an export of the internal factory, write to a temp file, import it.
const shim = src.replace(
  'export { Config, apply, inject, name };',
  'export { Config, apply, inject, name, createQuoteCnService };',
);
const tmp = new URL('../lib/.probe.mjs', import.meta.url);
writeFileSync(tmp, shim);
const { createQuoteCnService } = await import(tmp.href);

const svc = createQuoteCnService({
  pollIntervalMs: 5000,
  maxConcurrentFetches: 4,
  cacheTtlMs: 1000,
  defaultProvider: 'eastmoney',
  premium: { provider: 'longbridge', tokenEnv: 'X' },
});

const quotes = await svc.fetchDerived(['sh600519', 'sz300750']);
let ok = 0;
for (const q of quotes) {
  const d = q.derived;
  console.log(
    q.code, q.name, q.price,
    d ? `amp=${d.amplitude} pos=${d.dayRangePos} rel=${d.relativePct} 52wH=${d.pctFrom52wHigh} 52wL=${d.pctFrom52wLow} maDev=${JSON.stringify(d.maDev)}` : 'NO DERIVED',
  );
  if (d && Number.isFinite(d.amplitude) && Number.isFinite(d.dayRangePos) && Number.isFinite(d.relativePct)) ok += 1;
}
rmSync(tmp);
if (ok === 0) { console.error('FAIL: no derived metrics'); process.exit(1); }
console.log(`derived live check OK (${ok}/${quotes.length} with metrics)`);
process.exit(0);
