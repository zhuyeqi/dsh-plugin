import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

interface Quote {
  code: string;
  name: string;
  price: number;
  change: number;
  pct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  turnover: number;
  turnoverRate: number;
  pe: number;
  pb: number;
  marketCap: number;
  ts: number;
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

interface WatchlistProps {
  t: (key: string) => string;
}

/** Always-on market headers, served by the same snapshot endpoint. */
const INDEX_CODES = ['sh000001', 'sz399001', 'sz399006'];
const POLL_INTERVAL_MS = 5000;
const SEARCH_DEBOUNCE_MS = 250;
const DROPDOWN_MAX_HEIGHT = 240;
const SPARK_BARS = 30;

const UP_COLOR = '#e74c3c';
const DOWN_COLOR = '#27ae60';
const FLAT_COLOR = '#8b93a1';

export function WatchlistPanel({ t }: WatchlistProps) {
  const [watch, setWatch] = useState<string[]>(() => loadLocal<string[]>('quote-cn.watchlist', []));
  const [data, setData] = useState<Record<string, Quote>>({});
  const [sparks, setSparks] = useState<Record<string, number[] | null>>({});
  const [dragCode, setDragCode] = useState<string | null>(null);

  // Live reorder while dragging: drop the dragged code right before the row
  // currently under the pointer. Idempotent; persisted by the watch effect.
  const dragEnterRow = (target: string) => {
    if (!dragCode || dragCode === target) return;
    setWatch((prev) => {
      if (!prev.includes(dragCode) || !prev.includes(target)) return prev;
      const next = prev.filter((c) => c !== dragCode);
      next.splice(Math.max(next.indexOf(target), 0), 0, dragCode);
      return next;
    });
  };

  // Poll indices + watchlist together; indices keep ticking even with an empty list.
  useEffect(() => {
    saveLocal('quote-cn.watchlist', watch);
    let cancelled = false;
    const refresh = async () => {
      try {
        const quotes = await getSnapshot([...INDEX_CODES, ...watch]);
        if (cancelled) return;
        const next: Record<string, Quote> = {};
        for (const quote of quotes) next[quote.code] = quote;
        setData(next);
      } catch {
        /* keep last snapshot */
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watch.join(',')]);

  // Fetch one 30-day sparkline per newly added code (cached for the session).
  useEffect(() => {
    let cancelled = false;
    for (const code of watch) {
      if (code in sparks) continue;
      fetchSparkline(code)
        .then((closes) => { if (!cancelled) setSparks((prev) => ({ ...prev, [code]: closes })); })
        .catch(() => { if (!cancelled) setSparks((prev) => ({ ...prev, [code]: null })); });
    }
    return () => { cancelled = true; };
  }, [watch.join(','), sparks]);

  return (
    <div style={rootStyle}>
      <h3 style={titleStyle}>{t('title')}</h3>
      <p style={hintStyle}>{t('hint')}</p>
      <SearchBox
        t={t}
        has={(code) => watch.includes(code)}
        onPick={(code) => setWatch((prev) => (prev.includes(code) ? prev : [...prev, code]))}
      />

      <p style={sectionStyle}>{t('indices')}</p>
      <ul style={listStyle}>
        {INDEX_CODES.map((code) => (
          <IndexRow key={code} quote={data[code]} t={t} />
        ))}
      </ul>

      <p style={sectionStyle}>{t('watchSection')}</p>
      {watch.length === 0 ? (
        <p style={hintStyle}>{t('empty')}</p>
      ) : (
        <ul style={listStyle}>
          {watch.map((code) => (
            <WatchRow
              key={code}
              code={code}
              quote={data[code]}
              spark={sparks[code]}
              t={t}
              onRemove={() => setWatch((prev) => prev.filter((c) => c !== code))}
              dragging={dragCode === code}
              onDragStartRow={() => setDragCode(code)}
              onDragEnterRow={() => dragEnterRow(code)}
              onDragEndRow={() => setDragCode(null)}
            />
          ))}
        </ul>
      )}
      <p style={delayStyle}>{t('delayNote')}</p>
    </div>
  );
}

function IndexRow({ quote, t }: { quote?: Quote; t: (key: string) => string }) {
  const color = toneColor(toneOf(quote?.change));
  return (
    <li style={indexRowStyle}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {quote?.name ?? t('loading')}
      </span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
          {quote ? quote.price.toFixed(2) : '—'}
        </span>
        <span style={{ color, width: 72, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {quote ? `${quote.pct >= 0 ? '+' : ''}${quote.pct.toFixed(2)}%` : ''}
        </span>
      </span>
    </li>
  );
}

interface WatchRowProps {
  code: string;
  quote?: Quote;
  spark?: number[] | null;
  t: (key: string) => string;
  onRemove: () => void;
  dragging: boolean;
  onDragStartRow: () => void;
  onDragEnterRow: () => void;
  onDragEndRow: () => void;
}

function WatchRow(props: WatchRowProps) {
  const { code, quote, spark, t, onRemove, dragging, onDragStartRow, onDragEnterRow, onDragEndRow } = props;
  const [expanded, setExpanded] = useState(false);
  const suspended = quote !== undefined && quote.price <= 0;
  const tone: Tone = suspended ? 'flat' : toneOf(quote?.change);
  const color = toneColor(tone);

  // Collapsed-row indicators: amplitude + turnover on the sub line, day-range bar under price.
  const amplitude = quote
    ? quote.derived?.amplitude
      ?? (quote.prevClose > 0 && quote.high > 0 ? ((quote.high - quote.low) / quote.prevClose) * 100 : 0)
    : 0;
  const dayRangePos = quote
    ? quote.derived?.dayRangePos
      ?? (quote.high > quote.low ? (quote.price - quote.low) / (quote.high - quote.low) : 0.5)
    : 0.5;

  return (
    <li
      style={rowStyle(tone, dragging)}
      onDragEnter={onDragEnterRow}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/plain')) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); onDragEndRow(); }}
    >
      <div
        style={rowMainStyle}
        onClick={() => { if (!suspended) setExpanded((prev) => !prev); }}
      >
        <span
          draggable
          title={t('dragHint')}
          onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', code); } catch { /* Safari private mode */ }
            onDragStartRow();
          }}
          onDragEnd={onDragEndRow}
          style={handleStyle(dragging)}
          aria-label={t('dragHint')}
        >⠿</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {quote?.name ?? t('loading')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #8b93a1)', display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
            <code>{code}</code>
            {!suspended && quote && amplitude > 0 && (
              <span>{t('ampShort')} {amplitude.toFixed(2)}%</span>
            )}
            {!suspended && quote && quote.turnoverRate > 0 && (
              <span>{t('turnoverShort')} {quote.turnoverRate.toFixed(2)}%</span>
            )}
          </div>
        </div>
        <MiniSpark closes={suspended ? undefined : spark} />
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {suspended ? (
            <span style={{ color: FLAT_COLOR, fontSize: 13 }}>{t('suspended')}</span>
          ) : quote ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
                {quote.price.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color, fontVariantNumeric: 'tabular-nums' }}>
                {fmtSigned(quote.change)} {fmtSigned(quote.pct)}%
              </div>
              {quote.high > quote.low && Number.isFinite(dayRangePos) && (
                <div style={rangeTrackStyle} aria-hidden>
                  <span
                    style={{
                      position: 'absolute',
                      top: -1.5,
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      transform: 'translateX(-50%)',
                      left: `${Math.min(Math.max(Math.round(dayRangePos * 100), 3), 97)}%`,
                      background: color,
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <span style={{ color: FLAT_COLOR, fontSize: 12 }}>{t('loading')}</span>
          )}
        </div>
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} style={removeStyle}>
          {t('remove')}
        </button>
      </div>
      {expanded && quote && !suspended && (
        <>
          <IntradayChart code={code} prevClose={quote.prevClose} t={t} />
          <DetailGrid quote={quote} t={t} />
        </>
      )}
    </li>
  );
}

interface IntradayChartProps {
  code: string;
  prevClose: number;
  t: (key: string) => string;
}

interface IntradayPayload {
  minutes?: Array<{ t: string; p: number }>;
  prevClose?: number;
}

/** 当日分时: minute closes + dashed prev-close baseline. */
function IntradayChart({ code, prevClose, t }: IntradayChartProps) {
  const [payload, setPayload] = useState<IntradayPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setFailed(false);
    fetchIntraday(code)
      .then((data) => { if (!cancelled) setPayload(data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [code]);

  const minutes = payload?.minutes ?? [];
  const baseline = prevClose || payload?.prevClose || 0;
  if (failed) return <div style={intradayNoteStyle}>{t('intradayFailed')}</div>;
  if (minutes.length < 2) return <div style={intradayNoteStyle}>{t('loading')}</div>;

  const prices = minutes.map((m) => m.p);
  const min = Math.min(...prices, baseline > 0 ? baseline : Infinity);
  const max = Math.max(...prices, baseline > 0 ? baseline : -Infinity);
  const range = max - min || 1;
  const W = 100;
  const H = 40;
  // Anchor x to wall-clock time over the 240 trading minutes (09:30-11:30 + 13:00-15:00)
  // so a mid-session chart stops at "now" instead of stretching to 15:00.
  const xOf = (t: string) => {
    const hh = Number(t.slice(0, 2));
    const mm = Number(t.slice(2, 4));
    const abs = hh * 60 + mm;
    let pos: number;
    if (abs >= 13 * 60) pos = 120 + Math.min(Math.max(abs - 13 * 60, 0), 120);
    else pos = Math.min(Math.max(abs - (9 * 60 + 30), 0), 120);
    return (pos / 240) * W;
  };
  const yOf = (p: number) => H - ((p - min) / range) * H;
  const poly = minutes.map((m) => `${xOf(m.t).toFixed(2)},${yOf(m.p).toFixed(2)}`).join(' ');
  const up = minutes[minutes.length - 1].p >= (baseline || minutes[0].p);
  const color = up ? UP_COLOR : DOWN_COLOR;
  const lastX = xOf(minutes[minutes.length - 1].t);
  const area = `${poly} ${lastX.toFixed(2)},${H} 0,${H}`;
  const baseY = baseline > 0 ? yOf(baseline) : -1;

  return (
    <div style={intradayStyle}>
      <div style={intradayHeadStyle}>
        <span>{t('intraday')}</span>
        <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
          {t('intradayLow')} {Math.min(...prices).toFixed(2)} · {t('intradayHigh')} {Math.max(...prices).toFixed(2)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 64 }}>
        {baseY >= 0 && (
          <line x1="0" x2={W} y1={baseY} y2={baseY} stroke={FLAT_COLOR} strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        )}
        <polygon points={area} fill={color} opacity="0.08" />
        <polyline points={poly} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={intradayAxisStyle}>
        <span>09:30</span>
        <span>11:30/13:00</span>
        <span>15:00</span>
      </div>
    </div>
  );
}

function DetailGrid({ quote, t }: { quote: Quote; t: (key: string) => string }) {
  const useEn = t('unitSystem') === 'en';
  const amplitude = quote.prevClose > 0 && quote.high > 0
    ? ((quote.high - quote.low) / quote.prevClose) * 100
    : 0;
  const cells: Array<[string, string]> = [];
  if (quote.open > 0) cells.push([t('open'), quote.open.toFixed(2)]);
  if (quote.high > 0) cells.push([t('high'), quote.high.toFixed(2)]);
  if (quote.low > 0) cells.push([t('low'), quote.low.toFixed(2)]);
  if (quote.prevClose > 0) cells.push([t('prevClose'), quote.prevClose.toFixed(2)]);
  if (quote.turnover > 0) cells.push([t('turnover'), fmtAmount(quote.turnover, useEn)]);
  if (quote.volume > 0) cells.push([t('volume'), `${fmtAmount(quote.volume, useEn)}${t('unitLot')}`]);
  if (quote.turnoverRate > 0) cells.push([t('turnoverRate'), `${quote.turnoverRate.toFixed(2)}%`]);
  if (amplitude > 0) cells.push([t('amplitude'), `${amplitude.toFixed(2)}%`]);
  if (quote.pe > 0) cells.push([t('pe'), quote.pe.toFixed(2)]);
  if (quote.pb > 0) cells.push([t('pb'), quote.pb.toFixed(2)]);
  if (quote.marketCap > 0) cells.push([t('marketCap'), fmtAmount(quote.marketCap, useEn)]);
  // Derived analytics (server-computed; degrade silently when absent).
  const d = quote.derived;
  if (d) {
    if (Number.isFinite(d.dayRangePos)) {
      cells.push([useEn ? 'Day range' : '日内位置', `${Math.round(d.dayRangePos * 100)}%`]);
    }
    if (Number.isFinite(d.relativePct)) {
      cells.push([useEn ? 'vs SH index' : '相对上证', `${fmtSigned(d.relativePct)}%`]);
    }
    if (Number.isFinite(d.pctFrom52wHigh) && Number.isFinite(d.pctFrom52wLow)) {
      cells.push([useEn ? 'From 52w H/L' : '距52周高/低', `${fmtSigned(d.pctFrom52wHigh)}% / +${d.pctFrom52wLow.toFixed(2)}%`]);
    }
    for (const n of ['20', '60', '120'] as const) {
      const dev = d.maDev?.[n];
      if (dev !== undefined && Number.isFinite(dev)) {
        cells.push([useEn ? `MA${n} dev` : `MA${n}偏离`, `${fmtSigned(dev)}%`]);
      }
    }
  }
  if (quote.ts > 0) cells.push([t('dataTime'), fmtTime(quote.ts)]);
  return (
    <div style={gridStyle}>
      {cells.map(([label, value]) => (
        <div key={label} style={cellStyle}>
          <span style={cellLabelStyle}>{label}</span>
          <span style={cellValueStyle}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function MiniSpark({ closes }: { closes?: number[] | null }) {
  const points = (closes ?? []).filter((n) => Number.isFinite(n)).slice(-SPARK_BARS);
  if (points.length < 2) return <svg width={72} height={24} style={{ flexShrink: 0 }} aria-hidden />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 72;
  const h = 24;
  const step = w / (points.length - 1);
  const poly = points
    .map((c, i) => `${(i * step).toFixed(1)},${(h - ((c - min) / range) * h).toFixed(1)}`)
    .join(' ');
  const color = points[points.length - 1] >= points[0] ? UP_COLOR : DOWN_COLOR;
  return (
    <svg width={w} height={h} style={{ flexShrink: 0 }} aria-hidden>
      <polyline points={poly} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

interface SearchBoxProps {
  t: (key: string) => string;
  /** Whether a code is already in the watchlist (marks the suggestion). */
  has: (code: string) => boolean;
  /** Called with the picked code; the box clears itself afterwards. */
  onPick: (code: string) => void;
}

/** Combobox: debounced search with a selectable suggestion dropdown. */
export function SearchBox({ t, has, onPick }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seqRef = useRef(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  const trimmed = query.trim();

  // Debounced search; seq guard drops stale responses after rapid typing.
  useEffect(() => {
    if (!trimmed) {
      seqRef.current += 1;
      setHits([]);
      setLoading(false);
      setFailed(false);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      const seq = ++seqRef.current;
      search(trimmed)
        .then((results) => {
          if (seq !== seqRef.current) return;
          setHits(results);
          setFailed(false);
          setLoading(false);
          setOpen(true);
          setActiveIndex(results.length > 0 ? 0 : -1);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setFailed(true);
          setLoading(false);
          setOpen(true);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  // Keep the highlighted option visible while arrow-navigating.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const node = listRef.current.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pick = (code: string) => {
    onPick(code);
    setQuery('');
    setHits([]);
    setOpen(false);
    setActiveIndex(-1);
    setFailed(false);
  };

  /** Exact-code input adds directly; otherwise pick the highlighted (or first) suggestion. */
  const submit = () => {
    const direct = exactCode(trimmed);
    if (direct) {
      pick(direct);
      return;
    }
    if (hits.length > 0) {
      const index = activeIndex >= 0 && activeIndex < hits.length ? activeIndex : 0;
      pick(hits[index].code);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (hits.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => {
        if (event.key === 'ArrowDown') return (prev + 1) % hits.length;
        return prev <= 0 ? hits.length - 1 : prev - 1;
      });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const showDropdown = open && (loading || failed || trimmed.length > 0);

  return (
    <form onSubmit={onSubmit} style={boxStyle}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (hits.length > 0 || failed) setOpen(true); }}
        onBlur={() => setOpen(false)}
        placeholder={t('placeholder')}
        style={inputStyle}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
      />
      <button type="submit" style={buttonStyle}>{t('add')}</button>
      {showDropdown && (
        <ul ref={listRef} id={listId} role="listbox" style={dropStyle}>
          {loading ? (
            <li style={stateStyle} role="status">{t('searching')}</li>
          ) : failed ? (
            <li style={stateStyle} role="status">{t('searchFailed')}</li>
          ) : hits.length === 0 ? (
            <li style={stateStyle} role="status">{t('noMatch')}</li>
          ) : (
            hits.map((hit, index) => {
              const active = index === activeIndex;
              return (
                <li
                  key={hit.code}
                  id={`${listId}-opt-${index}`}
                  role="option"
                  aria-selected={active}
                  style={optionStyle(active)}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(hit.code)}
                >
                  <span style={optionNameStyle}>
                    <code style={codeStyle}>{hit.code}</code> {hit.name}
                  </span>
                  {has(hit.code) ? <span style={addedStyle}>{t('alreadyAdded')}</span> : null}
                </li>
              );
            })
          )}
        </ul>
      )}
    </form>
  );
}

/** `sh600519` / `600519` → normalized prefixed code; null when input is not an exact code. */
function exactCode(raw: string): string | null {
  const lower = raw.toLowerCase().replace(/\s+/g, '');
  if (/^(sh|sz|bj)\d{6}$/.test(lower)) return lower;
  if (/^\d{6}$/.test(lower)) {
    if (/^[69]/.test(lower)) return `sh${lower}`;
    if (/^[43]/.test(lower)) return `bj${lower}`;
    return `sz${lower}`;
  }
  return null;
}

type Tone = 'up' | 'down' | 'flat';

function toneOf(change: number | undefined): Tone {
  if (change === undefined || change === 0) return 'flat';
  return change > 0 ? 'up' : 'down';
}

function toneColor(tone: Tone): string {
  if (tone === 'up') return UP_COLOR;
  if (tone === 'down') return DOWN_COLOR;
  return FLAT_COLOR;
}

function fmtSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

/** zh: 万 / 亿 / 万亿；en: K / M / B / T. */
function fmtAmount(value: number, useEn: boolean): string {
  if (useEn) {
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
    return String(Math.round(value));
  }
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}万亿`;
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(2)}万`;
  return String(Math.round(value));
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function getSnapshot(codes: string[]): Promise<Quote[]> {
  const res = await fetch(`/quote-cn/snapshot?derived=1&codes=${encodeURIComponent(codes.join(','))}`);
  if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
  return res.json() as Promise<Quote[]>;
}

async function fetchSparkline(code: string): Promise<number[]> {
  const res = await fetch(`/quote-cn/kline?code=${encodeURIComponent(code)}&period=day&count=${SPARK_BARS}`);
  if (!res.ok) throw new Error(`kline HTTP ${res.status}`);
  const json = await res.json() as { bars?: Array<{ close: number }> };
  return (json.bars ?? []).map((bar) => bar.close);
}

async function fetchIntraday(code: string): Promise<IntradayPayload> {
  const res = await fetch(`/quote-cn/intraday?code=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error(`intraday HTTP ${res.status}`);
  return res.json() as Promise<IntradayPayload>;
}

async function search(query: string): Promise<SearchHit[]> {
  const res = await fetch(`/quote-cn/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  return res.json() as Promise<SearchHit[]>;
}

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function saveLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore quota */ }
}

const rootStyle: CSSProperties = { padding: 4, minWidth: 0 };
const titleStyle: CSSProperties = { margin: '0 0 8px', fontSize: 16, fontWeight: 500 };
const hintStyle: CSSProperties = { margin: '0 0 12px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8b93a1)' };
const sectionStyle: CSSProperties = { margin: '12px 0 4px', fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: 'var(--dsw-alias-label-tertiary, #8b93a1)' };
const delayStyle: CSSProperties = { margin: '12px 0 0', fontSize: 11, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary, #8b93a1)', opacity: 0.8 };
const boxStyle: CSSProperties = { position: 'relative', display: 'flex', gap: 8, marginBottom: 12 };
const inputStyle: CSSProperties = {
  flex: 1, minWidth: 0, padding: '6px 8px',
  border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)', borderRadius: 6,
};
const buttonStyle: CSSProperties = { padding: '6px 12px', borderRadius: 6, cursor: 'pointer' };
const dropStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  zIndex: 10,
  margin: '4px 0 0',
  padding: 4,
  listStyle: 'none',
  maxHeight: DROPDOWN_MAX_HEIGHT,
  overflowY: 'auto',
  border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
  borderRadius: 6,
  background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
};
const stateStyle: CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
};
const optionNameStyle: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const codeStyle: CSSProperties = { fontSize: 12 };
const addedStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
  flexShrink: 0,
};
const listStyle: CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };
const removeStyle: CSSProperties = { fontSize: 12, cursor: 'pointer', flexShrink: 0 };
const indexRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 8,
  padding: '5px 4px',
  fontSize: 13,
};
const rowMainStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
};
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
  gap: '6px 8px',
  padding: '8px 4px 2px',
};
const cellStyle: CSSProperties = { minWidth: 0 };
const cellLabelStyle: CSSProperties = { display: 'block', fontSize: 10, color: 'var(--dsw-alias-label-tertiary, #8b93a1)' };
const cellValueStyle: CSSProperties = { display: 'block', fontSize: 12, fontVariantNumeric: 'tabular-nums' };
const intradayStyle: CSSProperties = { padding: '8px 4px 2px', minWidth: 0 };
const intradayHeadStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 11,
  marginBottom: 4,
  color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
};
const intradayAxisStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 10,
  color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
  opacity: 0.8,
};
const intradayNoteStyle: CSSProperties = {
  padding: '8px 4px 2px',
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
};

function optionStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    background: active ? 'var(--dsw-alias-bg-layer-2, rgba(15, 23, 42, 0.06))' : 'transparent',
  };
}

function rowStyle(tone: Tone, dragging = false): CSSProperties {
  return {
    padding: '8px 4px',
    borderLeft: `3px solid ${toneColor(tone)}`,
    margin: '4px 0',
    opacity: tone === 'flat' ? 0.85 : dragging ? 0.45 : 1,
    background: dragging ? 'var(--dsw-alias-bg-layer-2, rgba(15, 23, 42, 0.05))' : undefined,
  };
}

function handleStyle(dragging: boolean): CSSProperties {
  return {
    cursor: dragging ? 'grabbing' : 'grab',
    flexShrink: 0,
    color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
    fontSize: 13,
    lineHeight: 1,
    padding: '4px 2px',
    userSelect: 'none',
  };
}

const rangeTrackStyle: CSSProperties = {
  position: 'relative',
  width: 72,
  height: 3,
  borderRadius: 2,
  background: 'var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.12))',
  marginTop: 3,
  marginLeft: 'auto',
};
