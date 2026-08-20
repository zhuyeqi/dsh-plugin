import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/service/secid.ts
/** Convert `sh600519` / `sz000001` / `bj830799` (or a bare 6-digit code) to Eastmoney secid. */
function codeToSecid(code) {
	const raw = code.trim().toLowerCase();
	if (raw.startsWith("sh")) return `1.${raw.slice(2)}`;
	if (raw.startsWith("sz") || raw.startsWith("bj")) return `0.${raw.slice(2)}`;
	if (/^[69]/.test(raw)) return `1.${raw}`;
	return `0.${raw}`;
}
/** Reconstruct a prefixed A-share code from Eastmoney market id + 6-digit code. */
function prefixedCode(market, digits) {
	const num = String(digits).padStart(6, "0");
	if (Number(market) === 1) return `sh${num}`;
	if (num.startsWith("8") || num.startsWith("4")) return `bj${num}`;
	return `sz${num}`;
}
//#endregion
//#region src/service/providers/eastmoney.ts
const UA$1 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const REFERER = "https://quote.eastmoney.com/";
/** Fields used by `qt/ulist.np/get` with `fltt=2` (prices already in yuan). */
const ULIST_FIELDS = [
	"f12",
	"f13",
	"f14",
	"f2",
	"f3",
	"f4",
	"f15",
	"f16",
	"f17",
	"f18",
	"f5",
	"f6",
	"f8",
	"f9",
	"f23",
	"f20",
	"f124"
].join(",");
async function fetchEastmoney(codes) {
	if (codes.length === 0) return [];
	const secids = codes.map(codeToSecid).join(",");
	const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
	url.searchParams.set("fltt", "2");
	url.searchParams.set("np", "1");
	url.searchParams.set("fields", ULIST_FIELDS);
	url.searchParams.set("secids", secids);
	const resp = await fetch(url, { headers: {
		"User-Agent": UA$1,
		Referer: REFERER
	} });
	if (!resp.ok) return [];
	const rows = (await resp.json()).data?.diff ?? [];
	const quotes = [];
	for (const row of rows) {
		const digits = String(row.f12 ?? "");
		if (!digits) continue;
		const price = num$2(row.f2);
		quotes.push({
			code: prefixedCode(row.f13, digits),
			name: String(row.f14 ?? ""),
			price,
			pct: num$2(row.f3),
			change: num$2(row.f4),
			high: num$2(row.f15),
			low: num$2(row.f16),
			open: num$2(row.f17),
			prevClose: num$2(row.f18),
			volume: num$2(row.f5),
			turnover: num$2(row.f6),
			turnoverRate: num$2(row.f8),
			pe: num$2(row.f9),
			pb: num$2(row.f23),
			marketCap: num$2(row.f20),
			ts: num$2(row.f124) ? num$2(row.f124) * 1e3 : Date.now()
		});
	}
	return quotes;
}
const KLT = {
	day: 101,
	week: 102,
	month: 103,
	"5": 5,
	"15": 15,
	"30": 30,
	"60": 60
};
const FQT = {
	qfq: 1,
	hfq: 2,
	none: 0
};
/** Daily/weekly/monthly & minute OHLCV history from Eastmoney (shared by tool + HTTP route). */
async function fetchKlineEastmoney(code, opts = {}) {
	const period = KLT[opts.period ?? "day"] !== void 0 ? opts.period ?? "day" : "day";
	const adjust = FQT[opts.adjust ?? "qfq"] !== void 0 ? opts.adjust ?? "qfq" : "qfq";
	const count = Math.min(Math.max(Math.trunc(opts.count ?? 60), 1), 500);
	const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
	url.searchParams.set("secid", codeToSecid(code));
	url.searchParams.set("fields1", "f1,f2,f3,f4,f5");
	url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58");
	url.searchParams.set("klt", String(KLT[period]));
	url.searchParams.set("fqt", String(FQT[adjust]));
	url.searchParams.set("end", "20500101");
	url.searchParams.set("lmt", String(count));
	const resp = await fetch(url, { headers: {
		"User-Agent": UA$1,
		Referer: REFERER
	} });
	if (!resp.ok) throw new Error(`kline upstream HTTP ${resp.status}`);
	return {
		code,
		period,
		bars: ((await resp.json()).data?.klines ?? []).map((line) => {
			const [ts, open, close, high, low, volume, turnover] = line.split(",");
			return {
				ts,
				open: Number(open),
				close: Number(close),
				high: Number(high),
				low: Number(low),
				volume: Number(volume),
				turnover: turnover ? Number(turnover) : void 0
			};
		})
	};
}
async function searchEastmoney(query, limit = 10) {
	const url = new URL("https://searchapi.eastmoney.com/api/suggest/get");
	url.searchParams.set("input", query);
	url.searchParams.set("type", "14");
	url.searchParams.set("count", String(limit));
	url.searchParams.set("token", "D43BF722C8E33BDC906FB84D85E326E8");
	const resp = await fetch(url, { headers: { "User-Agent": UA$1 } });
	if (!resp.ok) throw new Error(`quote_search upstream HTTP ${resp.status}`);
	return ((await resp.json()).QuotationCodeTable?.Data ?? []).map((item) => {
		const digits = String(item.Code ?? "");
		const mkt = String(item.MktNum ?? "");
		return {
			code: prefixedCode(mkt, digits),
			name: String(item.Name ?? ""),
			type: mkt
		};
	}).filter((hit) => /^\w{2}\d{6}$/.test(hit.code));
}
function num$2(value) {
	const n = typeof value === "string" ? Number(value) : Number(value);
	return Number.isFinite(n) ? n : 0;
}
//#endregion
//#region src/service/providers/tencent.ts
/**
* 腾讯行情源（默认）。
* - 快照: https://qt.gtimg.cn/q=sh600519,sz300750   (GBK 文本, ~ 分隔 88 字段)
* - 日K:  https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,30,qfq
* - 分时: https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600519
* 全部无需鉴权, 无 Referer 白名单（2026-08 实测）。
*/
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
/** qt.gtimg.cn `~`-separated field indexes (verified against Eastmoney values). */
const F = {
	market: 0,
	name: 1,
	price: 3,
	prevClose: 4,
	open: 5,
	volume: 6,
	datetime: 30,
	change: 31,
	pct: 32,
	high: 33,
	low: 34,
	turnover: 37,
	turnoverRate: 38,
	floatCap: 44,
	marketCap: 45,
	pb: 46,
	pe: 52
};
async function fetchTencent(codes) {
	if (codes.length === 0) return [];
	const url = `https://qt.gtimg.cn/q=${codes.join(",")}`;
	const resp = await fetch(url, { headers: { "User-Agent": UA } });
	if (!resp.ok) throw new Error(`tencent snapshot HTTP ${resp.status}`);
	const text = new TextDecoder("gbk").decode(new Uint8Array(await resp.arrayBuffer()));
	const quotes = [];
	for (const line of text.split("\n")) {
		const m = line.match(/v_(\w+)="([^"]*)"/);
		if (!m) continue;
		const f = m[2].split("~");
		if (f.length < 60) continue;
		const price = num$1(f[F.price]);
		if (price <= 0) continue;
		quotes.push({
			code: m[1],
			name: f[F.name],
			price,
			prevClose: num$1(f[F.prevClose]),
			open: num$1(f[F.open]),
			high: num$1(f[F.high]),
			low: num$1(f[F.low]),
			change: num$1(f[F.change]),
			pct: num$1(f[F.pct]),
			volume: num$1(f[F.volume]),
			turnover: num$1(f[F.turnover]) * 1e4,
			turnoverRate: num$1(f[F.turnoverRate]),
			pe: num$1(f[F.pe]),
			pb: num$1(f[F.pb]),
			marketCap: num$1(f[F.marketCap]) * 1e8,
			ts: parseQtTime(f[F.datetime])
		});
	}
	return quotes;
}
/** Daily/weekly/monthly bars via fqkline (复权). Minute periods are not handled here. */
async function fetchTencentKline(code, opts = {}) {
	const period = [
		"day",
		"week",
		"month"
	].includes(opts.period ?? "day") ? opts.period ?? "day" : "day";
	const adjust = opts.adjust === "hfq" ? "hfq" : "qfq";
	const count = Math.min(Math.max(Math.trunc(opts.count ?? 60), 1), 500);
	const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(`${code},${period},,,${count},${adjust}`)}`;
	const resp = await fetch(url, { headers: { "User-Agent": UA } });
	if (!resp.ok) throw new Error(`tencent kline HTTP ${resp.status}`);
	const json = await resp.json();
	if (json.code !== 0 || !json.data?.[code]) throw new Error("tencent kline empty payload");
	const payload = json.data[code];
	const rows = payload[`${adjust}${period}`] ?? payload[period];
	if (!Array.isArray(rows)) throw new Error("tencent kline missing rows");
	return {
		code,
		period,
		bars: rows.map((row) => {
			const r = row;
			return {
				ts: r[0],
				open: Number(r[1]),
				close: Number(r[2]),
				high: Number(r[3]),
				low: Number(r[4]),
				volume: Number(r[5])
			};
		})
	};
}
/** 当日分时: one point per trading minute (≈240 rows for a full session). */
async function fetchTencentIntraday(code) {
	const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(code)}`;
	const resp = await fetch(url, { headers: { "User-Agent": UA } });
	if (!resp.ok) throw new Error(`tencent intraday HTTP ${resp.status}`);
	const json = await resp.json();
	const payload = json.data?.[code]?.data;
	if (json.code !== 0 || !payload?.data) throw new Error("tencent intraday empty payload");
	const minutes = payload.data.map((row) => {
		const [t, p] = row.split(" ");
		return {
			t,
			p: Number(p)
		};
	}).filter((m) => m.t && Number.isFinite(m.p) && m.p > 0);
	return {
		code,
		date: payload.date ?? "",
		minutes
	};
}
function num$1(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}
/** `20260819161441` → epoch ms. */
function parseQtTime(raw) {
	if (!raw || !/^\d{14}$/.test(raw)) return Date.now();
	const s = raw;
	return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), Number(s.slice(8, 10)), Number(s.slice(10, 12)), Number(s.slice(12, 14))).getTime();
}
//#endregion
//#region src/service/providers/sina.ts
/**
* 新浪 hq.sinajs.cn 备份数据源。
* 返回格式: var hq_str_sh600000="贵州茅台,1680.50,1690.00,...";
* 字段顺序(逗号分隔,30 个):
*   0 名字 1 今开 2 昨收 3 当前价 4 今日最高 5 今日最低
*   6 买一价 7 卖一价 8 成交量(股) 9 成交额
*   ... 30 时间
*/
async function fetchSina(codes) {
	if (codes.length === 0) return [];
	const url = `https://hq.sinajs.cn/list=${codes.join(",")}`;
	const resp = await fetch(url, { headers: {
		"Referer": "https://finance.sina.com.cn/",
		"User-Agent": "Mozilla/5.0"
	} });
	if (!resp.ok) return [];
	const body = await resp.text();
	const quotes = [];
	const lines = body.split(/\n/);
	let idx = 0;
	for (const line of lines) {
		const m = line.match(/var hq_str_(\w+)="([^"]*)"/);
		if (!m) continue;
		const code = m[1];
		const fields = m[2].split(",");
		if (fields.length < 32 || idx >= codes.length) {
			idx++;
			continue;
		}
		const price = num(fields[3]);
		if (price === 0) {
			idx++;
			continue;
		}
		const prevClose = num(fields[2]);
		quotes.push({
			code,
			name: fields[0],
			price,
			open: num(fields[1]),
			prevClose,
			high: num(fields[4]),
			low: num(fields[5]),
			change: price - prevClose,
			pct: prevClose === 0 ? 0 : (price - prevClose) / prevClose * 100,
			volume: num(fields[8]),
			turnover: num(fields[9]),
			turnoverRate: 0,
			pe: 0,
			pb: 0,
			marketCap: 0,
			ts: parseSinaTime(fields[30], fields[31])
		});
		idx++;
	}
	return quotes;
}
function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}
function parseSinaTime(date, time) {
	if (!date || !time) return Date.now();
	const t = (/* @__PURE__ */ new Date(`${date}T${time}+08:00`)).getTime();
	return Number.isFinite(t) ? t : Date.now();
}
//#endregion
//#region src/service/providers/premium-adapter.ts
function fetchPremium(provider, token) {
	switch (provider) {
		case "longbridge": return (codes) => fetchLongbridge(codes, token);
		case "futu": return (codes) => fetchFutu(codes, token);
		case "tonglian": return (codes) => fetchTonglian(codes, token);
		default: return () => Promise.resolve([]);
	}
}
async function fetchLongbridge(_codes, _token) {
	throw new Error("longbridge provider is not implemented; falling back is handled by the service");
}
async function fetchFutu(_codes, _token) {
	throw new Error("futu provider is not implemented");
}
async function fetchTonglian(_codes, _token) {
	throw new Error("tonglian provider is not implemented");
}
//#endregion
//#region src/service/derived.ts
const MA_PERIODS = [
	20,
	60,
	120
];
/** Metrics computable from the snapshot alone (no kline fetch). */
function snapshotMetrics(quote, indexPct) {
	const amplitude = quote.prevClose > 0 ? round((quote.high - quote.low) / quote.prevClose * 100) : 0;
	const range = quote.high - quote.low;
	return {
		amplitude,
		dayRangePos: range > 0 ? round(Math.min(Math.max((quote.price - quote.low) / range, 0), 1)) : .5,
		relativePct: round(quote.pct - indexPct)
	};
}
/** Metrics that need daily kline closes (most recent last). */
function historyMetrics(closes) {
	const price = closes[closes.length - 1] ?? 0;
	const window = closes.slice(-250);
	const high = Math.max(...window);
	const low = Math.min(...window);
	const maDev = {};
	for (const period of MA_PERIODS) {
		const ma = sma(closes, period);
		maDev[String(period)] = ma === null ? NaN : round((price - ma) / ma * 100);
	}
	return {
		pctFrom52wHigh: high > 0 ? round((price - high) / high * 100) : 0,
		pctFrom52wLow: low > 0 ? round((price - low) / low * 100) : 0,
		maDev
	};
}
/** Simple moving average over the last `period` closes; null when insufficient data. */
function sma(closes, period) {
	if (closes.length < period) return null;
	let sum = 0;
	for (let i = closes.length - period; i < closes.length; i += 1) sum += closes[i];
	return sum / period;
}
function round(value) {
	return Math.round(value * 100) / 100;
}
//#endregion
//#region src/service/quote-cn-service.ts
function createQuoteCnService(config) {
	const cache = /* @__PURE__ */ new Map();
	const klineCache = /* @__PURE__ */ new Map();
	const intradayCache = /* @__PURE__ */ new Map();
	const subs = /* @__PURE__ */ new Set();
	const provider = pickProviderChain(config);
	const get = (codes) => codes.map((code) => cache.get(normalize(code))?.quote).filter((q) => q !== void 0);
	const put = (quotes) => {
		const now = Date.now();
		for (const quote of quotes) cache.set(normalize(quote.code), {
			quote,
			at: now
		});
	};
	const fetchFresh = async (codes) => {
		const unique = [...new Set(codes.map(normalize).filter(Boolean))];
		if (unique.length === 0) return [];
		const now = Date.now();
		const stale = [];
		const fresh = [];
		for (const code of unique) {
			const hit = cache.get(code);
			if (hit && now - hit.at < config.cacheTtlMs) fresh.push(hit.quote);
			else stale.push(code);
		}
		if (stale.length === 0) return orderBy(fresh, unique);
		const fetched = await provider(stale.slice(0, config.maxConcurrentFetches * 4));
		put(fetched);
		return orderBy([...fresh, ...fetched], unique);
	};
	return {
		get,
		fetch: fetchFresh,
		async search(query, market) {
			let hits = await searchEastmoney(query);
			if (market) {
				const prefix = market.toLowerCase();
				hits = hits.filter((hit) => hit.code.startsWith(prefix));
			}
			return hits;
		},
		kline(code, opts = {}) {
			const key = `${normalize(code)}|${opts.period ?? "day"}|${opts.count ?? 60}|${opts.adjust ?? "qfq"}`;
			const hit = klineCache.get(key);
			if (hit && Date.now() - hit.at < 6e5) return Promise.resolve(hit.result);
			const canTencent = [
				"day",
				"week",
				"month"
			].includes(opts.period ?? "day") && (opts.adjust ?? "qfq") !== "none";
			const run = async () => {
				if (canTencent) try {
					return await fetchTencentKline(code, opts);
				} catch {}
				return fetchKlineEastmoney(code, opts);
			};
			return run().then((result) => {
				klineCache.set(key, {
					result,
					at: Date.now()
				});
				return result;
			});
		},
		intraday(code) {
			const key = normalize(code);
			const hit = intradayCache.get(key);
			if (hit && Date.now() - hit.at < 6e4) return Promise.resolve(hit.result);
			return fetchTencentIntraday(code).then((result) => {
				intradayCache.set(key, {
					result,
					at: Date.now()
				});
				return result;
			});
		},
		async fetchDerived(codes) {
			const quotes = await fetchFresh(codes);
			if (quotes.length === 0) return quotes;
			let indexPct = 0;
			try {
				const index = (await fetchFresh(["sh000001"]))[0];
				if (index) indexPct = index.pct;
			} catch {}
			await Promise.allSettled(quotes.map(async (quote) => {
				const base = snapshotMetrics(quote, indexPct);
				let hist;
				try {
					const closes = (await this.kline(quote.code, {
						period: "day",
						count: 250,
						adjust: "qfq"
					})).bars.map((bar) => bar.close).filter((close) => Number.isFinite(close) && close > 0);
					if (closes.length > 0 && quote.price > 0) closes[closes.length - 1] = quote.price;
					if (closes.length > 0) hist = historyMetrics(closes);
				} catch {}
				quote.derived = hist ? {
					amplitude: base.amplitude,
					dayRangePos: base.dayRangePos,
					relativePct: base.relativePct,
					pctFrom52wHigh: hist.pctFrom52wHigh,
					pctFrom52wLow: hist.pctFrom52wLow,
					maDev: hist.maDev
				} : {
					amplitude: base.amplitude,
					dayRangePos: base.dayRangePos,
					relativePct: base.relativePct
				};
			}));
			return quotes;
		},
		subscribe(codes) {
			for (const code of codes.map(normalize).filter(Boolean)) subs.add(code);
		},
		unsubscribe(codes) {
			for (const code of codes.map(normalize)) subs.delete(code);
		},
		listWatchlist() {
			return [...subs];
		},
		async poll() {
			if (!isAShareSession(/* @__PURE__ */ new Date()) || subs.size === 0) return [];
			return fetchFresh([...subs]);
		}
	};
}
/**
* Ordered fallback chain of snapshot providers. The configured provider leads;
* the remaining free sources back it up. First non-empty result wins, so one
* dead upstream never blanks the panel.
*/
function pickProviderChain(config) {
	const free = {
		tencent: fetchTencent,
		eastmoney: fetchEastmoney,
		sina: fetchSina
	};
	const lead = pickLeadProvider(config);
	const chain = [];
	if (lead === "premium") {
		const premium = fetchPremium(config.premium.provider, process.env[config.premium.tokenEnv] ?? "");
		chain.push(premium);
	} else if (free[lead]) chain.push(free[lead]);
	for (const key of [
		"tencent",
		"eastmoney",
		"sina"
	]) if (!chain.includes(free[key])) chain.push(free[key]);
	return async (codes) => {
		let lastError;
		for (const fetcher of chain) try {
			const quotes = await fetcher(codes);
			if (quotes.length > 0) return quotes;
		} catch (error) {
			lastError = error;
		}
		if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
		return [];
	};
}
function pickLeadProvider(config) {
	switch (config.defaultProvider) {
		case "eastmoney": return "eastmoney";
		case "sina": return "sina";
		case "premium": {
			const name = config.premium.provider;
			if (!(config.premium.tokenEnv ? process.env[config.premium.tokenEnv] ?? "" : "") || name !== "longbridge" && name !== "futu" && name !== "tonglian") return "tencent";
			return "premium";
		}
		default: return "tencent";
	}
}
function normalize(code) {
	return code.trim().toLowerCase();
}
function orderBy(quotes, codes) {
	const map = new Map(quotes.map((q) => [normalize(q.code), q]));
	return codes.map((code) => map.get(code)).filter((q) => q !== void 0);
}
function isAShareSession(now) {
	const utc = now.getTime() + now.getTimezoneOffset() * 6e4;
	const beijing = new Date(utc + 288e5);
	const day = beijing.getDay();
	if (day === 0 || day === 6) return false;
	const minutes = beijing.getHours() * 60 + beijing.getMinutes();
	return minutes >= 570 && minutes < 690 || minutes >= 780 && minutes < 900;
}
//#endregion
//#region src/api/http.ts
function sendJson(response, status, payload) {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8"
	});
	response.end(JSON.stringify(payload));
}
function requestUrl(request) {
	return new URL(request.url ?? "/", "http://127.0.0.1");
}
//#endregion
//#region src/api/routes.ts
function mountQuoteRoutes(webServer, service) {
	const disposers = [
		webServer.register({
			kind: "exact",
			path: "/quote-cn/health",
			handler: (_req, res) => {
				sendJson(res, 200, {
					ok: true,
					plugin: "@your-org/dsh-plugin-quote-cn"
				});
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/quote-cn/snapshot",
			handler: async (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				const codes = (requestUrl(req).searchParams.get("codes") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
				try {
					sendJson(res, 200, requestUrl(req).searchParams.get("derived") === "1" ? await service.fetchDerived(codes) : await service.fetch(codes));
				} catch (error) {
					sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/quote-cn/search",
			handler: async (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				const query = requestUrl(req).searchParams.get("q")?.trim() ?? "";
				if (!query) {
					sendJson(res, 400, { error: "missing q" });
					return;
				}
				try {
					sendJson(res, 200, await service.search(query, requestUrl(req).searchParams.get("market") ?? void 0));
				} catch (error) {
					sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/quote-cn/kline",
			handler: async (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				const params = requestUrl(req).searchParams;
				const code = params.get("code")?.trim().toLowerCase() ?? "";
				if (!/^(sh|sz|bj)\d{6}$/.test(code)) {
					sendJson(res, 400, { error: "invalid code, expected e.g. sh600519" });
					return;
				}
				const period = params.get("period") ?? "day";
				if (![
					"day",
					"week",
					"month",
					"5",
					"15",
					"30",
					"60"
				].includes(period)) {
					sendJson(res, 400, { error: "invalid period" });
					return;
				}
				const adjust = params.get("adjust") ?? "qfq";
				if (![
					"qfq",
					"hfq",
					"none"
				].includes(adjust)) {
					sendJson(res, 400, { error: "invalid adjust" });
					return;
				}
				const countRaw = Number(params.get("count") ?? 30);
				const count = Number.isFinite(countRaw) ? Math.min(Math.max(Math.trunc(countRaw), 1), 500) : 30;
				try {
					sendJson(res, 200, await service.kline(code, {
						period,
						count,
						adjust
					}));
				} catch (error) {
					sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/quote-cn/intraday",
			handler: async (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				const code = requestUrl(req).searchParams.get("code")?.trim().toLowerCase() ?? "";
				if (!/^(sh|sz|bj)\d{6}$/.test(code)) {
					sendJson(res, 400, { error: "invalid code, expected e.g. sh600519" });
					return;
				}
				try {
					const intraday = await service.intraday(code);
					const quote = service.get([code])[0];
					sendJson(res, 200, {
						code: intraday.code,
						date: intraday.date,
						minutes: intraday.minutes,
						prevClose: quote?.prevClose ?? 0
					});
				} catch (error) {
					sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	];
	return () => {
		for (const dispose of disposers) dispose();
	};
}
//#endregion
//#region src/tools/quote-get.ts
function registerQuoteGetTool(ctx, service) {
	ctx.systemPrompt.section({
		name: "tool:quote_get",
		order: 200,
		text: `Use quote_get to fetch real-time A-share quotes (price, change, pe, etc).
Stock codes are 6 digits with exchange prefix: 'sh600000', 'sz000001', 'bj830799'.
Always call this BEFORE making investment-related claims.`
	});
	ctx.tools.register(defineTool({
		name: "quote_get",
		description: "Get real-time A-share quote snapshot for one or more stocks. Returns price, change, pct, OHLC, volume, turnover, pe, pb, marketCap, plus derived analytics (derived.amplitude 振幅%, derived.dayRangePos 日内位置0-1, derived.relativePct 相对上证超额%, derived.pctFrom52wHigh/pctFrom52wLow 距52周高低点%, derived.maDev 距MA20/60/120均线偏离%).",
		parameters: { codes: {
			type: "array",
			required: true,
			items: { type: "string" },
			description: "Stock codes with exchange prefix, e.g. [\"sh600000\",\"sz000001\"]. sh=沪市, sz=深市, bj=北交所."
		} },
		output: {
			schema: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						code: {
							type: "string",
							required: true
						},
						name: {
							type: "string",
							required: true
						},
						price: {
							type: "number",
							required: true
						},
						change: {
							type: "number",
							required: true
						},
						pct: {
							type: "number",
							required: true
						},
						open: { type: "number" },
						high: { type: "number" },
						low: { type: "number" },
						prevClose: { type: "number" },
						volume: { type: "number" },
						turnover: { type: "number" },
						turnoverRate: { type: "number" },
						pe: { type: "number" },
						pb: { type: "number" },
						marketCap: { type: "number" },
						derived: {
							type: "object",
							additionalProperties: false,
							properties: {
								amplitude: {
									type: "number",
									description: "振幅 (high-low)/prevClose, %"
								},
								dayRangePos: {
									type: "number",
									description: "日内位置 (price-low)/(high-low), 0..1"
								},
								relativePct: {
									type: "number",
									description: "相对上证指数超额涨跌, %"
								},
								pctFrom52wHigh: {
									type: "number",
									description: "距52周高点, % (<=0)"
								},
								pctFrom52wLow: {
									type: "number",
									description: "距52周低点, % (>=0)"
								},
								maDev: {
									type: "object",
									additionalProperties: false,
									description: "距N日均线偏离度 (price-MA_N)/MA_N, %; keys: 20/60/120",
									properties: {
										"20": { type: "number" },
										"60": { type: "number" },
										"120": { type: "number" }
									}
								}
							}
						},
						ts: {
							type: "number",
							required: true
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.map((q) => {
					let line = `${q.code} ${q.name}: ¥${q.price.toFixed(2)} (${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)} ${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%)`;
					const d = q.derived;
					if (d) {
						const ma = [
							"20",
							"60",
							"120"
						].filter((n) => Number.isFinite(d.maDev?.[n])).map((n) => `MA${n} ${fmtPct(d.maDev[n])}`);
						line += ` | 振幅 ${d.amplitude.toFixed(2)}% 日内位 ${(d.dayRangePos * 100).toFixed(0)}% 相对上证 ${fmtPct(d.relativePct)}`;
						if (Number.isFinite(d.pctFrom52wHigh)) line += ` 距52周高 ${fmtPct(d.pctFrom52wHigh)}/低 +${d.pctFrom52wLow.toFixed(2)}%`;
						if (ma.length > 0) line += ` | ${ma.join(" ")}`;
					}
					return line;
				}).join("\n")
			}],
			presentationMeta: ((_args, value) => ({ quotes: value }))
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			const quotes = await service.fetchDerived(args.codes);
			if (quotes.length === 0) throw new Error(`No data for codes [${args.codes.join(", ")}]. Codes may be invalid. Valid prefixes: sh (沪市), sz (深市), bj (北交所).`);
			return quotes;
		},
		presentCall: (args) => ({
			card: "generic",
			kind: "fetch",
			title: `行情 ${args.codes.join(", ")}`
		}),
		presentResult: (_args, result) => result.isError ? void 0 : {
			card: "generic",
			title: "行情快照"
		}
	}));
}
function fmtPct(value) {
	return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
//#endregion
//#region src/tools/quote-search.ts
function registerQuoteSearchTool(ctx, service) {
	ctx.systemPrompt.section({
		name: "tool:quote_search",
		order: 201,
		text: `Use quote_search to find an A-share stock by Chinese name or partial code.
Returns up to 10 matches; pair with quote_get for full quote.`
	});
	ctx.tools.register(defineTool({
		name: "quote_search",
		description: "Search A-share stocks by Chinese name or 6-digit code. Returns up to 10 matches.",
		parameters: {
			query: {
				type: "string",
				required: true,
				description: "搜索关键词 (中文名或部分代码)"
			},
			market: {
				type: "string",
				description: "市场过滤: sh / sz / bj, 不传则全部"
			}
		},
		output: {
			schema: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						code: {
							type: "string",
							required: true
						},
						name: {
							type: "string",
							required: true
						},
						type: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.length === 0 ? "No matching stocks found." : value.map((v) => `${v.code} ${v.name}`).join("\n")
			}],
			presentationMeta: (_args, value) => ({ matches: value })
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			return service.search(args.query, args.market);
		},
		presentCall: (args) => ({
			card: "generic",
			kind: "search",
			title: `搜股 ${args.query}`
		}),
		presentResult: (_args, result) => result.isError ? void 0 : {
			card: "generic",
			title: "股票搜索"
		}
	}));
}
//#endregion
//#region src/tools/quote-kline.ts
function registerQuoteKlineTool(ctx, service) {
	ctx.systemPrompt.section({
		name: "tool:quote_kline",
		order: 202,
		text: `Use quote_kline to fetch OHLCV history for an A-share stock.
Supports daily/weekly/monthly and minute-level (5/15/30/60min).`
	});
	ctx.tools.register(defineTool({
		name: "quote_kline",
		description: "Get OHLCV (open, high, low, close, volume) history for an A-share stock. Returns up to 500 bars.",
		parameters: {
			code: {
				type: "string",
				required: true,
				description: "Stock code with prefix, e.g. \"sh600000\""
			},
			period: {
				type: "string",
				default: "day",
				description: "day | week | month | 5 | 15 | 30 | 60 (分钟)"
			},
			count: {
				type: "number",
				default: 60,
				description: "返回 K 线根数,最大 500"
			},
			adjust: {
				type: "string",
				default: "qfq",
				description: "qfq (前复权) | hfq (后复权) | none (不复权)"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					code: {
						type: "string",
						required: true
					},
					period: {
						type: "string",
						required: true
					},
					bars: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								ts: {
									type: "string",
									required: true
								},
								open: {
									type: "number",
									required: true
								},
								high: {
									type: "number",
									required: true
								},
								low: {
									type: "number",
									required: true
								},
								close: {
									type: "number",
									required: true
								},
								volume: {
									type: "number",
									required: true
								},
								turnover: { type: "number" }
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `${value.code} ${value.period} ${value.bars.length} bars. Last close: ¥${value.bars[value.bars.length - 1]?.close.toFixed(2)}`
			}],
			presentationMeta: (_args, value) => value
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			return service.kline(args.code, {
				period: args.period,
				count: args.count,
				adjust: args.adjust
			});
		},
		presentCall: (args) => ({
			card: "generic",
			kind: "fetch",
			title: `K线 ${args.code} ${args.period ?? "day"}`
		}),
		presentResult: (_args, result) => result.isError ? void 0 : {
			card: "generic",
			title: "K 线"
		}
	}));
}
//#endregion
//#region src/tools/index.ts
function registerQuoteTools(ctx, service) {
	registerQuoteGetTool(ctx, service);
	registerQuoteSearchTool(ctx, service);
	registerQuoteKlineTool(ctx, service);
}
//#endregion
//#region src/index.ts
/**
* Host entry for the A-share quote plugin.
*
* One cordis row, named after this package so `dsh-client-modules` can
* discover `dsh.client` and serve `/plugins/@your-org/dsh-plugin-quote-cn/client.js`.
*/
const name = "quote-cn";
const inject = ["timer"];
const Config = z.object({
	pollIntervalMs: z.number().min(1e3).default(5e3),
	maxConcurrentFetches: z.number().min(1).max(16).default(4),
	cacheTtlMs: z.number().min(500).default(4e3),
	defaultProvider: z.string().default("tencent"),
	premium: z.object({
		provider: z.string().default("longbridge"),
		tokenEnv: z.string().default("LONGBRIDGE_TOKEN")
	}).default({
		provider: "longbridge",
		tokenEnv: "LONGBRIDGE_TOKEN"
	})
});
function apply(ctx, config) {
	const service = createQuoteCnService(config);
	ctx.effect(() => ctx.timer.setInterval(() => {
		service.poll();
	}, config.pollIntervalMs), "quote-cn: poll");
	ctx.inject(["webServer"], (host) => {
		host.effect(() => mountQuoteRoutes(host.webServer, service), "quote-cn: http routes");
	});
	ctx.inject(["tools", "systemPrompt"], (agent) => {
		registerQuoteTools(agent, service);
	});
}
//#endregion
export { Config, apply, inject, name };
