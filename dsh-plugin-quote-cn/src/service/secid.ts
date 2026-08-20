/** Convert `sh600519` / `sz000001` / `bj830799` (or a bare 6-digit code) to Eastmoney secid. */
export function codeToSecid(code: string): string {
  const raw = code.trim().toLowerCase();
  if (raw.startsWith('sh')) return `1.${raw.slice(2)}`;
  if (raw.startsWith('sz') || raw.startsWith('bj')) return `0.${raw.slice(2)}`;
  if (/^[69]/.test(raw)) return `1.${raw}`;
  return `0.${raw}`;
}

/** Reconstruct a prefixed A-share code from Eastmoney market id + 6-digit code. */
export function prefixedCode(market: number | string, digits: string): string {
  const num = String(digits).padStart(6, '0');
  const mkt = Number(market);
  if (mkt === 1) return `sh${num}`;
  if (num.startsWith('8') || num.startsWith('4')) return `bj${num}`;
  return `sz${num}`;
}
