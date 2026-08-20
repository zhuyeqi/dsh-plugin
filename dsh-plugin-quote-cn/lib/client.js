window.__ModuleLoader__.load({
	id: "@your-org/dsh-plugin-quote-cn",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/sidebar.tsx
		/** Always-on market headers, served by the same snapshot endpoint. */
		const INDEX_CODES = [
			"sh000001",
			"sz399001",
			"sz399006"
		];
		const POLL_INTERVAL_MS = 5e3;
		const SEARCH_DEBOUNCE_MS = 250;
		const DROPDOWN_MAX_HEIGHT = 240;
		const SPARK_BARS = 30;
		const UP_COLOR = "#e74c3c";
		const DOWN_COLOR = "#27ae60";
		const FLAT_COLOR = "#8b93a1";
		function WatchlistPanel({ t }) {
			const [watch, setWatch] = (0, react.useState)(() => loadLocal("quote-cn.watchlist", []));
			const [data, setData] = (0, react.useState)({});
			const [sparks, setSparks] = (0, react.useState)({});
			const [dragCode, setDragCode] = (0, react.useState)(null);
			const dragEnterRow = (target) => {
				if (!dragCode || dragCode === target) return;
				setWatch((prev) => {
					if (!prev.includes(dragCode) || !prev.includes(target)) return prev;
					const next = prev.filter((c) => c !== dragCode);
					next.splice(Math.max(next.indexOf(target), 0), 0, dragCode);
					return next;
				});
			};
			(0, react.useEffect)(() => {
				saveLocal("quote-cn.watchlist", watch);
				let cancelled = false;
				const refresh = async () => {
					try {
						const quotes = await getSnapshot([...INDEX_CODES, ...watch]);
						if (cancelled) return;
						const next = {};
						for (const quote of quotes) next[quote.code] = quote;
						setData(next);
					} catch {}
				};
				refresh();
				const timer = window.setInterval(() => {
					refresh();
				}, POLL_INTERVAL_MS);
				return () => {
					cancelled = true;
					window.clearInterval(timer);
				};
			}, [watch.join(",")]);
			(0, react.useEffect)(() => {
				let cancelled = false;
				for (const code of watch) {
					if (code in sparks) continue;
					fetchSparkline(code).then((closes) => {
						if (!cancelled) setSparks((prev) => ({
							...prev,
							[code]: closes
						}));
					}).catch(() => {
						if (!cancelled) setSparks((prev) => ({
							...prev,
							[code]: null
						}));
					});
				}
				return () => {
					cancelled = true;
				};
			}, [watch.join(","), sparks]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rootStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: titleStyle,
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: hintStyle,
						children: t("hint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchBox, {
						t,
						has: (code) => watch.includes(code),
						onPick: (code) => setWatch((prev) => prev.includes(code) ? prev : [...prev, code])
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: sectionStyle,
						children: t("indices")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: listStyle,
						children: INDEX_CODES.map((code) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IndexRow, {
							quote: data[code],
							t
						}, code))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: sectionStyle,
						children: t("watchSection")
					}),
					watch.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: hintStyle,
						children: t("empty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: listStyle,
						children: watch.map((code) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WatchRow, {
							code,
							quote: data[code],
							spark: sparks[code],
							t,
							onRemove: () => setWatch((prev) => prev.filter((c) => c !== code)),
							dragging: dragCode === code,
							onDragStartRow: () => setDragCode(code),
							onDragEnterRow: () => dragEnterRow(code),
							onDragEndRow: () => setDragCode(null)
						}, code))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: delayStyle,
						children: t("delayNote")
					})
				]
			});
		}
		function IndexRow({ quote, t }) {
			const color = toneColor(toneOf(quote?.change));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: indexRowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap"
					},
					children: quote?.name ?? t("loading")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: {
						display: "flex",
						gap: 8,
						alignItems: "baseline"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							color,
							fontVariantNumeric: "tabular-nums"
						},
						children: quote ? quote.price.toFixed(2) : "—"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							color,
							width: 72,
							textAlign: "right",
							fontVariantNumeric: "tabular-nums"
						},
						children: quote ? `${quote.pct >= 0 ? "+" : ""}${quote.pct.toFixed(2)}%` : ""
					})]
				})]
			});
		}
		function WatchRow(props) {
			const { code, quote, spark, t, onRemove, dragging, onDragStartRow, onDragEnterRow, onDragEndRow } = props;
			const [expanded, setExpanded] = (0, react.useState)(false);
			const suspended = quote !== void 0 && quote.price <= 0;
			const tone = suspended ? "flat" : toneOf(quote?.change);
			const color = toneColor(tone);
			const amplitude = quote ? quote.derived?.amplitude ?? (quote.prevClose > 0 && quote.high > 0 ? (quote.high - quote.low) / quote.prevClose * 100 : 0) : 0;
			const dayRangePos = quote ? quote.derived?.dayRangePos ?? (quote.high > quote.low ? (quote.price - quote.low) / (quote.high - quote.low) : .5) : .5;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: rowStyle(tone, dragging),
				onDragEnter: onDragEnterRow,
				onDragOver: (e) => {
					if (e.dataTransfer.types.includes("text/plain")) e.preventDefault();
				},
				onDrop: (e) => {
					e.preventDefault();
					onDragEndRow();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: rowMainStyle,
					onClick: () => {
						if (!suspended) setExpanded((prev) => !prev);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							draggable: true,
							title: t("dragHint"),
							onClick: (e) => e.stopPropagation(),
							onDragStart: (e) => {
								e.dataTransfer.effectAllowed = "move";
								try {
									e.dataTransfer.setData("text/plain", code);
								} catch {}
								onDragStartRow();
							},
							onDragEnd: onDragEndRow,
							style: handleStyle(dragging),
							"aria-label": t("dragHint"),
							children: "⠿"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								minWidth: 0,
								flex: 1
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontWeight: 500,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap"
								},
								children: quote?.name ?? t("loading")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									fontSize: 11,
									color: "var(--dsw-alias-label-tertiary, #8b93a1)",
									display: "flex",
									gap: 6,
									whiteSpace: "nowrap"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: code }),
									!suspended && quote && amplitude > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										t("ampShort"),
										" ",
										amplitude.toFixed(2),
										"%"
									] }),
									!suspended && quote && quote.turnoverRate > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										t("turnoverShort"),
										" ",
										quote.turnoverRate.toFixed(2),
										"%"
									] })
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MiniSpark, { closes: suspended ? void 0 : spark }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								textAlign: "right",
								flexShrink: 0
							},
							children: suspended ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									color: FLAT_COLOR,
									fontSize: 13
								},
								children: t("suspended")
							}) : quote ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 15,
										fontWeight: 600,
										color,
										fontVariantNumeric: "tabular-nums"
									},
									children: quote.price.toFixed(2)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										fontSize: 12,
										color,
										fontVariantNumeric: "tabular-nums"
									},
									children: [
										fmtSigned(quote.change),
										" ",
										fmtSigned(quote.pct),
										"%"
									]
								}),
								quote.high > quote.low && Number.isFinite(dayRangePos) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: rangeTrackStyle,
									"aria-hidden": true,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
										position: "absolute",
										top: -1.5,
										width: 6,
										height: 6,
										borderRadius: 3,
										transform: "translateX(-50%)",
										left: `${Math.min(Math.max(Math.round(dayRangePos * 100), 3), 97)}%`,
										background: color
									} })
								})
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									color: FLAT_COLOR,
									fontSize: 12
								},
								children: t("loading")
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: (e) => {
								e.stopPropagation();
								onRemove();
							},
							style: removeStyle,
							children: t("remove")
						})
					]
				}), expanded && quote && !suspended && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IntradayChart, {
					code,
					prevClose: quote.prevClose,
					t
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailGrid, {
					quote,
					t
				})] })]
			});
		}
		/** 当日分时: minute closes + dashed prev-close baseline. */
		function IntradayChart({ code, prevClose, t }) {
			const [payload, setPayload] = (0, react.useState)(null);
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let cancelled = false;
				setPayload(null);
				setFailed(false);
				fetchIntraday(code).then((data) => {
					if (!cancelled) setPayload(data);
				}).catch(() => {
					if (!cancelled) setFailed(true);
				});
				return () => {
					cancelled = true;
				};
			}, [code]);
			const minutes = payload?.minutes ?? [];
			const baseline = prevClose || payload?.prevClose || 0;
			if (failed) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: intradayNoteStyle,
				children: t("intradayFailed")
			});
			if (minutes.length < 2) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: intradayNoteStyle,
				children: t("loading")
			});
			const prices = minutes.map((m) => m.p);
			const min = Math.min(...prices, baseline > 0 ? baseline : Infinity);
			const range = Math.max(...prices, baseline > 0 ? baseline : -Infinity) - min || 1;
			const W = 100;
			const H = 40;
			const xOf = (t) => {
				const hh = Number(t.slice(0, 2));
				const mm = Number(t.slice(2, 4));
				const abs = hh * 60 + mm;
				let pos;
				if (abs >= 780) pos = 120 + Math.min(Math.max(abs - 780, 0), 120);
				else pos = Math.min(Math.max(abs - 570, 0), 120);
				return pos / 240 * W;
			};
			const yOf = (p) => H - (p - min) / range * H;
			const poly = minutes.map((m) => `${xOf(m.t).toFixed(2)},${yOf(m.p).toFixed(2)}`).join(" ");
			const color = minutes[minutes.length - 1].p >= (baseline || minutes[0].p) ? UP_COLOR : DOWN_COLOR;
			const area = `${poly} ${xOf(minutes[minutes.length - 1].t).toFixed(2)},${H} 0,${H}`;
			const baseY = baseline > 0 ? yOf(baseline) : -1;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: intradayStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: intradayHeadStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("intraday") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								color,
								fontVariantNumeric: "tabular-nums"
							},
							children: [
								t("intradayLow"),
								" ",
								Math.min(...prices).toFixed(2),
								" · ",
								t("intradayHigh"),
								" ",
								Math.max(...prices).toFixed(2)
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
						viewBox: `0 0 ${W} ${H}`,
						preserveAspectRatio: "none",
						style: {
							display: "block",
							width: "100%",
							height: 64
						},
						children: [
							baseY >= 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
								x1: "0",
								x2: W,
								y1: baseY,
								y2: baseY,
								stroke: FLAT_COLOR,
								strokeWidth: "1",
								strokeDasharray: "2 2",
								vectorEffect: "non-scaling-stroke"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", {
								points: area,
								fill: color,
								opacity: "0.08"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", {
								points: poly,
								fill: "none",
								stroke: color,
								strokeWidth: "1.4",
								vectorEffect: "non-scaling-stroke"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: intradayAxisStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "09:30" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "11:30/13:00" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "15:00" })
						]
					})
				]
			});
		}
		function DetailGrid({ quote, t }) {
			const useEn = t("unitSystem") === "en";
			const amplitude = quote.prevClose > 0 && quote.high > 0 ? (quote.high - quote.low) / quote.prevClose * 100 : 0;
			const cells = [];
			if (quote.open > 0) cells.push([t("open"), quote.open.toFixed(2)]);
			if (quote.high > 0) cells.push([t("high"), quote.high.toFixed(2)]);
			if (quote.low > 0) cells.push([t("low"), quote.low.toFixed(2)]);
			if (quote.prevClose > 0) cells.push([t("prevClose"), quote.prevClose.toFixed(2)]);
			if (quote.turnover > 0) cells.push([t("turnover"), fmtAmount(quote.turnover, useEn)]);
			if (quote.volume > 0) cells.push([t("volume"), `${fmtAmount(quote.volume, useEn)}${t("unitLot")}`]);
			if (quote.turnoverRate > 0) cells.push([t("turnoverRate"), `${quote.turnoverRate.toFixed(2)}%`]);
			if (amplitude > 0) cells.push([t("amplitude"), `${amplitude.toFixed(2)}%`]);
			if (quote.pe > 0) cells.push([t("pe"), quote.pe.toFixed(2)]);
			if (quote.pb > 0) cells.push([t("pb"), quote.pb.toFixed(2)]);
			if (quote.marketCap > 0) cells.push([t("marketCap"), fmtAmount(quote.marketCap, useEn)]);
			const d = quote.derived;
			if (d) {
				if (Number.isFinite(d.dayRangePos)) cells.push([useEn ? "Day range" : "日内位置", `${Math.round(d.dayRangePos * 100)}%`]);
				if (Number.isFinite(d.relativePct)) cells.push([useEn ? "vs SH index" : "相对上证", `${fmtSigned(d.relativePct)}%`]);
				if (Number.isFinite(d.pctFrom52wHigh) && Number.isFinite(d.pctFrom52wLow)) cells.push([useEn ? "From 52w H/L" : "距52周高/低", `${fmtSigned(d.pctFrom52wHigh)}% / +${d.pctFrom52wLow.toFixed(2)}%`]);
				for (const n of [
					"20",
					"60",
					"120"
				]) {
					const dev = d.maDev?.[n];
					if (dev !== void 0 && Number.isFinite(dev)) cells.push([useEn ? `MA${n} dev` : `MA${n}偏离`, `${fmtSigned(dev)}%`]);
				}
			}
			if (quote.ts > 0) cells.push([t("dataTime"), fmtTime(quote.ts)]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: gridStyle,
				children: cells.map(([label, value]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: cellStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: cellLabelStyle,
						children: label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: cellValueStyle,
						children: value
					})]
				}, label))
			});
		}
		function MiniSpark({ closes }) {
			const points = (closes ?? []).filter((n) => Number.isFinite(n)).slice(-30);
			if (points.length < 2) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: 72,
				height: 24,
				style: { flexShrink: 0 },
				"aria-hidden": true
			});
			const min = Math.min(...points);
			const range = Math.max(...points) - min || 1;
			const w = 72;
			const h = 24;
			const step = w / (points.length - 1);
			const poly = points.map((c, i) => `${(i * step).toFixed(1)},${(h - (c - min) / range * h).toFixed(1)}`).join(" ");
			const color = points[points.length - 1] >= points[0] ? UP_COLOR : DOWN_COLOR;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: w,
				height: h,
				style: { flexShrink: 0 },
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", {
					points: poly,
					fill: "none",
					stroke: color,
					strokeWidth: "1.2"
				})
			});
		}
		/** Combobox: debounced search with a selectable suggestion dropdown. */
		function SearchBox({ t, has, onPick }) {
			const [query, setQuery] = (0, react.useState)("");
			const [hits, setHits] = (0, react.useState)([]);
			const [open, setOpen] = (0, react.useState)(false);
			const [activeIndex, setActiveIndex] = (0, react.useState)(-1);
			const [loading, setLoading] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(false);
			const seqRef = (0, react.useRef)(0);
			const listRef = (0, react.useRef)(null);
			const listId = (0, react.useId)();
			const trimmed = query.trim();
			(0, react.useEffect)(() => {
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
					search(trimmed).then((results) => {
						if (seq !== seqRef.current) return;
						setHits(results);
						setFailed(false);
						setLoading(false);
						setOpen(true);
						setActiveIndex(results.length > 0 ? 0 : -1);
					}).catch(() => {
						if (seq !== seqRef.current) return;
						setFailed(true);
						setLoading(false);
						setOpen(true);
					});
				}, SEARCH_DEBOUNCE_MS);
				return () => window.clearTimeout(timer);
			}, [trimmed]);
			(0, react.useEffect)(() => {
				if (activeIndex < 0 || !listRef.current) return;
				listRef.current.children[activeIndex]?.scrollIntoView({ block: "nearest" });
			}, [activeIndex]);
			const pick = (code) => {
				onPick(code);
				setQuery("");
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
			const onKeyDown = (event) => {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					if (hits.length === 0) return;
					event.preventDefault();
					setOpen(true);
					setActiveIndex((prev) => {
						if (event.key === "ArrowDown") return (prev + 1) % hits.length;
						return prev <= 0 ? hits.length - 1 : prev - 1;
					});
				} else if (event.key === "Enter") {
					event.preventDefault();
					submit();
				} else if (event.key === "Escape" && open) {
					event.preventDefault();
					setOpen(false);
				}
			};
			const onSubmit = (event) => {
				event.preventDefault();
				submit();
			};
			const showDropdown = open && (loading || failed || trimmed.length > 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				onSubmit,
				style: boxStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: query,
						onChange: (e) => setQuery(e.target.value),
						onKeyDown,
						onFocus: () => {
							if (hits.length > 0 || failed) setOpen(true);
						},
						onBlur: () => setOpen(false),
						placeholder: t("placeholder"),
						style: inputStyle,
						role: "combobox",
						"aria-expanded": showDropdown,
						"aria-controls": listId,
						"aria-autocomplete": "list",
						"aria-activedescendant": activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : void 0
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "submit",
						style: buttonStyle,
						children: t("add")
					}),
					showDropdown && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						ref: listRef,
						id: listId,
						role: "listbox",
						style: dropStyle,
						children: loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							style: stateStyle,
							role: "status",
							children: t("searching")
						}) : failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							style: stateStyle,
							role: "status",
							children: t("searchFailed")
						}) : hits.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							style: stateStyle,
							role: "status",
							children: t("noMatch")
						}) : hits.map((hit, index) => {
							const active = index === activeIndex;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								id: `${listId}-opt-${index}`,
								role: "option",
								"aria-selected": active,
								style: optionStyle(active),
								onMouseDown: (e) => e.preventDefault(),
								onMouseEnter: () => setActiveIndex(index),
								onClick: () => pick(hit.code),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: optionNameStyle,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											style: codeStyle,
											children: hit.code
										}),
										" ",
										hit.name
									]
								}), has(hit.code) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: addedStyle,
									children: t("alreadyAdded")
								}) : null]
							}, hit.code);
						})
					})
				]
			});
		}
		/** `sh600519` / `600519` → normalized prefixed code; null when input is not an exact code. */
		function exactCode(raw) {
			const lower = raw.toLowerCase().replace(/\s+/g, "");
			if (/^(sh|sz|bj)\d{6}$/.test(lower)) return lower;
			if (/^\d{6}$/.test(lower)) {
				if (/^[69]/.test(lower)) return `sh${lower}`;
				if (/^[43]/.test(lower)) return `bj${lower}`;
				return `sz${lower}`;
			}
			return null;
		}
		function toneOf(change) {
			if (change === void 0 || change === 0) return "flat";
			return change > 0 ? "up" : "down";
		}
		function toneColor(tone) {
			if (tone === "up") return UP_COLOR;
			if (tone === "down") return DOWN_COLOR;
			return FLAT_COLOR;
		}
		function fmtSigned(value) {
			return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
		}
		/** zh: 万 / 亿 / 万亿；en: K / M / B / T. */
		function fmtAmount(value, useEn) {
			if (useEn) {
				if (value >= 0xe8d4a51000) return `${(value / 0xe8d4a51000).toFixed(2)}T`;
				if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
				if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
				if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
				return String(Math.round(value));
			}
			if (value >= 0xe8d4a51000) return `${(value / 0xe8d4a51000).toFixed(2)}万亿`;
			if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
			if (value >= 1e4) return `${(value / 1e4).toFixed(2)}万`;
			return String(Math.round(value));
		}
		function fmtTime(ts) {
			const d = new Date(ts);
			const pad = (n) => String(n).padStart(2, "0");
			return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
		}
		async function getSnapshot(codes) {
			const res = await fetch(`/quote-cn/snapshot?derived=1&codes=${encodeURIComponent(codes.join(","))}`);
			if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
			return res.json();
		}
		async function fetchSparkline(code) {
			const res = await fetch(`/quote-cn/kline?code=${encodeURIComponent(code)}&period=day&count=${SPARK_BARS}`);
			if (!res.ok) throw new Error(`kline HTTP ${res.status}`);
			return ((await res.json()).bars ?? []).map((bar) => bar.close);
		}
		async function fetchIntraday(code) {
			const res = await fetch(`/quote-cn/intraday?code=${encodeURIComponent(code)}`);
			if (!res.ok) throw new Error(`intraday HTTP ${res.status}`);
			return res.json();
		}
		async function search(query) {
			const res = await fetch(`/quote-cn/search?q=${encodeURIComponent(query)}`);
			if (!res.ok) throw new Error(`search HTTP ${res.status}`);
			return res.json();
		}
		function loadLocal(key, fallback) {
			try {
				const raw = localStorage.getItem(key);
				return raw ? JSON.parse(raw) : fallback;
			} catch {
				return fallback;
			}
		}
		function saveLocal(key, value) {
			try {
				localStorage.setItem(key, JSON.stringify(value));
			} catch {}
		}
		const rootStyle = {
			padding: 4,
			minWidth: 0
		};
		const titleStyle = {
			margin: "0 0 8px",
			fontSize: 16,
			fontWeight: 500
		};
		const hintStyle = {
			margin: "0 0 12px",
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary, #8b93a1)"
		};
		const sectionStyle = {
			margin: "12px 0 4px",
			fontSize: 11,
			fontWeight: 600,
			letterSpacing: .4,
			color: "var(--dsw-alias-label-tertiary, #8b93a1)"
		};
		const delayStyle = {
			margin: "12px 0 0",
			fontSize: 11,
			textAlign: "center",
			color: "var(--dsw-alias-label-tertiary, #8b93a1)",
			opacity: .8
		};
		const boxStyle = {
			position: "relative",
			display: "flex",
			gap: 8,
			marginBottom: 12
		};
		const inputStyle = {
			flex: 1,
			minWidth: 0,
			padding: "6px 8px",
			border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
			borderRadius: 6
		};
		const buttonStyle = {
			padding: "6px 12px",
			borderRadius: 6,
			cursor: "pointer"
		};
		const dropStyle = {
			position: "absolute",
			top: "100%",
			left: 0,
			right: 0,
			zIndex: 10,
			margin: "4px 0 0",
			padding: 4,
			listStyle: "none",
			maxHeight: DROPDOWN_MAX_HEIGHT,
			overflowY: "auto",
			border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
			borderRadius: 6,
			background: "var(--dsw-alias-bg-layer-1, #ffffff)",
			boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)"
		};
		const stateStyle = {
			padding: "6px 8px",
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary, #8b93a1)"
		};
		const optionNameStyle = {
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const codeStyle = { fontSize: 12 };
		const addedStyle = {
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary, #8b93a1)",
			flexShrink: 0
		};
		const listStyle = {
			listStyle: "none",
			padding: 0,
			margin: 0
		};
		const removeStyle = {
			fontSize: 12,
			cursor: "pointer",
			flexShrink: 0
		};
		const indexRowStyle = {
			display: "flex",
			justifyContent: "space-between",
			alignItems: "baseline",
			gap: 8,
			padding: "5px 4px",
			fontSize: 13
		};
		const rowMainStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			cursor: "pointer"
		};
		const gridStyle = {
			display: "grid",
			gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
			gap: "6px 8px",
			padding: "8px 4px 2px"
		};
		const cellStyle = { minWidth: 0 };
		const cellLabelStyle = {
			display: "block",
			fontSize: 10,
			color: "var(--dsw-alias-label-tertiary, #8b93a1)"
		};
		const cellValueStyle = {
			display: "block",
			fontSize: 12,
			fontVariantNumeric: "tabular-nums"
		};
		const intradayStyle = {
			padding: "8px 4px 2px",
			minWidth: 0
		};
		const intradayHeadStyle = {
			display: "flex",
			justifyContent: "space-between",
			fontSize: 11,
			marginBottom: 4,
			color: "var(--dsw-alias-label-tertiary, #8b93a1)"
		};
		const intradayAxisStyle = {
			display: "flex",
			justifyContent: "space-between",
			fontSize: 10,
			color: "var(--dsw-alias-label-tertiary, #8b93a1)",
			opacity: .8
		};
		const intradayNoteStyle = {
			padding: "8px 4px 2px",
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary, #8b93a1)"
		};
		function optionStyle(active) {
			return {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: 8,
				padding: "6px 8px",
				borderRadius: 4,
				cursor: "pointer",
				fontSize: 13,
				background: active ? "var(--dsw-alias-bg-layer-2, rgba(15, 23, 42, 0.06))" : "transparent"
			};
		}
		function rowStyle(tone, dragging = false) {
			return {
				padding: "8px 4px",
				borderLeft: `3px solid ${toneColor(tone)}`,
				margin: "4px 0",
				opacity: tone === "flat" ? .85 : dragging ? .45 : 1,
				background: dragging ? "var(--dsw-alias-bg-layer-2, rgba(15, 23, 42, 0.05))" : void 0
			};
		}
		function handleStyle(dragging) {
			return {
				cursor: dragging ? "grabbing" : "grab",
				flexShrink: 0,
				color: "var(--dsw-alias-label-tertiary, #8b93a1)",
				fontSize: 13,
				lineHeight: 1,
				padding: "4px 2px",
				userSelect: "none"
			};
		}
		const rangeTrackStyle = {
			position: "relative",
			width: 72,
			height: 3,
			borderRadius: 2,
			background: "var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.12))",
			marginTop: 3,
			marginLeft: "auto"
		};
		//#endregion
		//#region src/client/quote-card.tsx
		function QuoteCard({ block }) {
			if (!isSettled(block)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: "查询行情中…" });
			if (block.isError) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: errorText(block) });
			const quotes = block.meta?.quotes ?? [];
			if (quotes.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: "暂无数据" });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
				style: {
					width: "100%",
					borderCollapse: "collapse"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
					style: {
						textAlign: "left",
						color: "#666",
						fontSize: 12
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "代码 / 名称" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							style: { textAlign: "right" },
							children: "现价"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							style: { textAlign: "right" },
							children: "涨跌额"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							style: { textAlign: "right" },
							children: "涨跌幅"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							style: { textAlign: "right" },
							children: "振幅"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							style: { textAlign: "right" },
							children: "相对上证"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							style: { textAlign: "right" },
							children: "距52周高/低"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							style: { textAlign: "right" },
							children: "MA偏离"
						})
					]
				}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: quotes.map((q) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
					style: { borderTop: "1px solid #eee" },
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: q.code }),
							" ",
							q.name
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
							style: cell(q.change),
							children: ["¥", q.price.toFixed(2)]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
							style: cell(q.change),
							children: [q.change >= 0 ? "+" : "", q.change.toFixed(2)]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
							style: cell(q.change),
							children: [
								q.pct >= 0 ? "+" : "",
								q.pct.toFixed(2),
								"%"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							style: muted(),
							children: q.derived ? `${q.derived.amplitude.toFixed(2)}%` : "—"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							style: cell(q.derived?.relativePct ?? 0),
							children: q.derived ? signed(q.derived.relativePct, "%") : "—"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							style: muted(),
							children: q.derived && Number.isFinite(q.derived.pctFrom52wHigh) ? `${signed(q.derived.pctFrom52wHigh, "")} / +${q.derived.pctFrom52wLow.toFixed(2)}%` : "—"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							style: muted(),
							children: q.derived?.maDev ? [
								"20",
								"60",
								"120"
							].filter((n) => Number.isFinite(q.derived?.maDev?.[n])).map((n) => `${n}:${signed(q.derived?.maDev?.[n] ?? 0, "%")}`).join(" ") : "—"
						})
					]
				}, q.code)) })]
			}) });
		}
		function SearchCard({ block }) {
			if (!isSettled(block)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: "搜索中…" });
			if (block.isError) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: errorText(block) });
			const matches = block.meta?.matches ?? [];
			if (matches.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: "未找到匹配股票" });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				style: {
					listStyle: "none",
					padding: 0,
					margin: 0
				},
				children: matches.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					style: { padding: "4px 0" },
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: m.code }),
						" ",
						m.name
					]
				}, m.code))
			}) });
		}
		function KLineCard({ block }) {
			if (!isSettled(block)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: "拉取 K 线…" });
			if (block.isError) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: errorText(block) });
			const kline = block.meta ?? {};
			const bars = kline.bars ?? [];
			if (bars.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: "暂无 K 线" });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					marginBottom: 8,
					fontSize: 12,
					color: "#666"
				},
				children: [
					kline.code,
					" · ",
					kline.period,
					" · ",
					bars.length,
					" 根"
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Sparkline, { bars: bars.slice(-30) })] });
		}
		function isSettled(block) {
			return block.kind === "tool-result";
		}
		function errorText(block) {
			return block.content?.find((item) => item.type === "text")?.text || "查询失败";
		}
		function Card({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: cardStyle,
				children
			});
		}
		const cardStyle = {
			border: "1px solid var(--dsw-alias-border-l2, #e0e0e0)",
			borderRadius: 6,
			padding: 8,
			margin: "8px 0",
			background: "var(--dsw-alias-bg-layer-1, #fafbfc)",
			fontFamily: "ui-sans-serif, system-ui",
			fontSize: 13
		};
		function cell(change) {
			return {
				textAlign: "right",
				color: change > 0 ? "#e74c3c" : change < 0 ? "#27ae60" : "#333",
				fontVariantNumeric: "tabular-nums"
			};
		}
		function muted() {
			return {
				textAlign: "right",
				color: "#8a8f98",
				fontVariantNumeric: "tabular-nums"
			};
		}
		function signed(value, suffix) {
			return `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
		}
		function Sparkline({ bars }) {
			if (bars.length === 0) return null;
			const closes = bars.map((b) => b.close);
			const min = Math.min(...closes);
			const range = Math.max(...closes) - min || 1;
			const w = 280;
			const h = 50;
			const step = w / Math.max(closes.length - 1, 1);
			const pts = closes.map((c, i) => `${i * step},${h - (c - min) / range * h}`).join(" ");
			const color = closes[closes.length - 1] >= closes[0] ? "#e74c3c" : "#27ae60";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: w,
				height: h,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", {
					points: pts,
					fill: "none",
					stroke: color,
					strokeWidth: "1.5"
				})
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			nav: "行情",
			title: "A 股自选",
			hint: "输入代码（sh600519）或名称搜索，从下拉候选中选择加入自选。点击自选行可展开分时与详情，拖动 ⠿ 调整顺序。数据来自腾讯免费接口（东财备份）。",
			placeholder: "搜索代码或名称，例如 茅台 / sh600519",
			add: "添加",
			empty: "还没有自选股",
			loading: "加载中…",
			remove: "移除",
			dragHint: "拖动调整顺序",
			ampShort: "振幅",
			turnoverShort: "换手",
			searching: "搜索中…",
			noMatch: "无匹配结果",
			searchFailed: "搜索失败，请重试",
			alreadyAdded: "已添加",
			indices: "大盘指数",
			watchSection: "自选",
			suspended: "停牌",
			open: "今开",
			high: "最高",
			low: "最低",
			prevClose: "昨收",
			volume: "成交量",
			turnover: "成交额",
			turnoverRate: "换手率",
			amplitude: "振幅",
			pe: "市盈率",
			pb: "市净率",
			marketCap: "总市值",
			dataTime: "数据时间",
			delayNote: "免费行情源，数据可能延时",
			intraday: "当日分时",
			intradayHigh: "高",
			intradayLow: "低",
			intradayFailed: "分时数据获取失败",
			unitSystem: "zh",
			unitLot: "手"
		};
		const en = {
			nav: "Quotes",
			title: "A-share watchlist",
			hint: "Type a code (sh600519) or name to search, then pick from the suggestions. Click a row to expand intraday chart and details; drag ⠿ to reorder. Data from Tencent free feed (Eastmoney backup).",
			placeholder: "Search code or name, e.g. 茅台 / sh600519",
			add: "Add",
			empty: "No symbols yet",
			loading: "Loading…",
			remove: "Remove",
			dragHint: "Drag to reorder",
			ampShort: "Amp",
			turnoverShort: "Turn",
			searching: "Searching…",
			noMatch: "No matches",
			searchFailed: "Search failed, try again",
			alreadyAdded: "Added",
			indices: "Major Indices",
			watchSection: "Watchlist",
			suspended: "Suspended",
			open: "Open",
			high: "High",
			low: "Low",
			prevClose: "Prev Close",
			volume: "Volume",
			turnover: "Turnover",
			turnoverRate: "Turnover Rate",
			amplitude: "Amplitude",
			pe: "P/E",
			pb: "P/B",
			marketCap: "Mkt Cap",
			dataTime: "Data Time",
			delayNote: "Free feed; data may be delayed",
			intraday: "Intraday",
			intradayHigh: "H",
			intradayLow: "L",
			intradayFailed: "Failed to load intraday data",
			unitSystem: "en",
			unitLot: " lots"
		};
		//#endregion
		//#region src/client.ts
		/**
		* Browser entry: settings section (watchlist) + keyed tool views.
		* tsdown wraps this file in window.__ModuleLoader__.load({ id, factory }).
		*/
		const NS = "quote-cn";
		const name = "quote-cn";
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "quote-cn: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "quote-cn",
				order: 45,
				label: () => t("nav"),
				locale: NS
			}, () => (0, react.createElement)(WatchlistPanel, { t })));
			ctx.slots.inject("tool.call.toolview", function* () {
				yield ctx.slots.register({
					name: "tool.call.toolview",
					key: "quote_get",
					locale: NS
				}, QuoteCard);
				yield ctx.slots.register({
					name: "tool.call.toolview",
					key: "quote_search",
					locale: NS
				}, SearchCard);
				yield ctx.slots.register({
					name: "tool.call.toolview",
					key: "quote_kline",
					locale: NS
				}, KLineCard);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map