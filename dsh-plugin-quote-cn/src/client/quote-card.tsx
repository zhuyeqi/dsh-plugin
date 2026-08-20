import type { CSSProperties, ReactNode } from 'react';

interface Quote {
  code: string;
  name: string;
  price: number;
  change: number;
  pct: number;
  derived?: {
    amplitude: number;
    dayRangePos: number;
    relativePct: number;
    pctFrom52wHigh: number;
    pctFrom52wLow: number;
    maDev?: Record<string, number>;
  };
}

interface SearchHit {
  code: string;
  name: string;
}

interface KlinePayload {
  code?: string;
  period?: string;
  bars?: Array<{ ts: string; close: number }>;
}

interface ToolBlock {
  kind?: string;
  isError?: boolean;
  meta?: {
    quotes?: Quote[];
    matches?: SearchHit[];
    code?: string;
    period?: string;
    bars?: Array<{ ts: string; close: number }>;
  };
  content?: Array<{ type?: string; text?: string }>;
}

interface ToolViewProps {
  toolName: string;
  block: ToolBlock;
}

export function QuoteCard({ block }: ToolViewProps) {
  if (!isSettled(block)) return <Card>查询行情中…</Card>;
  if (block.isError) return <Card>{errorText(block)}</Card>;
  const quotes = block.meta?.quotes ?? [];
  if (quotes.length === 0) return <Card>暂无数据</Card>;
  return (
    <Card>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#666', fontSize: 12 }}>
            <th>代码 / 名称</th>
            <th style={{ textAlign: 'right' }}>现价</th>
            <th style={{ textAlign: 'right' }}>涨跌额</th>
            <th style={{ textAlign: 'right' }}>涨跌幅</th>
            <th style={{ textAlign: 'right' }}>振幅</th>
            <th style={{ textAlign: 'right' }}>相对上证</th>
            <th style={{ textAlign: 'right' }}>距52周高/低</th>
            <th style={{ textAlign: 'right' }}>MA偏离</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => (
            <tr key={q.code} style={{ borderTop: '1px solid #eee' }}>
              <td><code>{q.code}</code> {q.name}</td>
              <td style={cell(q.change)}>¥{q.price.toFixed(2)}</td>
              <td style={cell(q.change)}>{q.change >= 0 ? '+' : ''}{q.change.toFixed(2)}</td>
              <td style={cell(q.change)}>{q.pct >= 0 ? '+' : ''}{q.pct.toFixed(2)}%</td>
              <td style={muted()}>{q.derived ? `${q.derived.amplitude.toFixed(2)}%` : '—'}</td>
              <td style={cell(q.derived?.relativePct ?? 0)}>
                {q.derived ? signed(q.derived.relativePct, '%') : '—'}
              </td>
              <td style={muted()}>
                {q.derived && Number.isFinite(q.derived.pctFrom52wHigh)
                  ? `${signed(q.derived.pctFrom52wHigh, '')} / +${q.derived.pctFrom52wLow.toFixed(2)}%`
                  : '—'}
              </td>
              <td style={muted()}>
                {q.derived?.maDev
                  ? (['20', '60', '120'] as const)
                      .filter((n) => Number.isFinite(q.derived?.maDev?.[n]))
                      .map((n) => `${n}:${signed(q.derived?.maDev?.[n] ?? 0, '%')}`)
                      .join(' ')
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function SearchCard({ block }: ToolViewProps) {
  if (!isSettled(block)) return <Card>搜索中…</Card>;
  if (block.isError) return <Card>{errorText(block)}</Card>;
  const matches = block.meta?.matches ?? [];
  if (matches.length === 0) return <Card>未找到匹配股票</Card>;
  return (
    <Card>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {matches.map((m) => (
          <li key={m.code} style={{ padding: '4px 0' }}>
            <code>{m.code}</code> {m.name}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function KLineCard({ block }: ToolViewProps) {
  if (!isSettled(block)) return <Card>拉取 K 线…</Card>;
  if (block.isError) return <Card>{errorText(block)}</Card>;
  const kline = (block.meta ?? {}) as KlinePayload;
  const bars = kline.bars ?? [];
  if (bars.length === 0) return <Card>暂无 K 线</Card>;
  return (
    <Card>
      <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
        {kline.code} · {kline.period} · {bars.length} 根
      </div>
      <Sparkline bars={bars.slice(-30)} />
    </Card>
  );
}

function isSettled(block: ToolBlock): boolean {
  return block.kind === 'tool-result';
}

function errorText(block: ToolBlock): string {
  const text = block.content?.find((item) => item.type === 'text')?.text;
  return text || '查询失败';
}

function Card({ children }: { children: ReactNode }) {
  return <div style={cardStyle}>{children}</div>;
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2, #e0e0e0)',
  borderRadius: 6,
  padding: 8,
  margin: '8px 0',
  background: 'var(--dsw-alias-bg-layer-1, #fafbfc)',
  fontFamily: 'ui-sans-serif, system-ui',
  fontSize: 13,
};

function cell(change: number): CSSProperties {
  return {
    textAlign: 'right',
    color: change > 0 ? '#e74c3c' : change < 0 ? '#27ae60' : '#333',
    fontVariantNumeric: 'tabular-nums',
  };
}

function muted(): CSSProperties {
  return { textAlign: 'right', color: '#8a8f98', fontVariantNumeric: 'tabular-nums' };
}

function signed(value: number, suffix: string): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}${suffix}`;
}

function Sparkline({ bars }: { bars: Array<{ close: number }> }) {
  if (bars.length === 0) return null;
  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const w = 280;
  const h = 50;
  const step = w / Math.max(closes.length - 1, 1);
  const pts = closes.map((c, i) => `${i * step},${h - ((c - min) / range) * h}`).join(' ');
  const color = closes[closes.length - 1] >= closes[0] ? '#e74c3c' : '#27ae60';
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" /></svg>;
}
