window.__ModuleLoader__.load({
	id: "@zhuyeqi/dsh-plugin-llm-mmsp",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region client.jsx
		/**
		* Browser half of the MMSP model adapter: the provider-card extension the
		* Models settings page dispatches for this adapter family's namespace
		* (`settings.models.provider-card`, keyed `entryKey = settingsNs`).
		*
		* The page's built-in editor ships curated layouts for `llm-deepseek` and
		* `llm-pi-ai` only; every other adapter family is addressed through this
		* keyed slot. The card below edits one MMSP route's profile — display name,
		* base URL, thinking default, thinking replay, and the curated model list —
		* as minimal path ops against the stored settings section, and stores a typed
		* API key through the credential seam under the profile's named reference
		* (deriving `<ROUTE>_API_KEY` when the profile names none, matching the
		* page's own rule). Model discovery interrogates the endpoint through the
		* same `llm/discoverModels` remote the page's own editors use.
		*
		* The card mirrors the page's own visual language (field/label metrics,
		* button sizes, model-entry borders, theme aliases) through one scoped
		* stylesheet rendered with the component, so no host CSS module is imported
		* and the bundle stays self-contained.
		*/
		const NS = "llm-mmsp";
		const ZH = {
			title: "MMSP 路由设置",
			key: "API 密钥",
			keySaved: "已存储",
			keyMissing: "未配置",
			keyPlaceholder: "留空使用已保存凭据",
			displayName: "显示名称",
			baseURL: "接入地址(MMSP Base URL)",
			baseURLHint: "以 /stream 之前结尾,如 https://go.penguin.ooo/api/v1",
			thinking: "默认思考档位",
			thinkingUnset: "未设置(跟随服务端默认)",
			replay: "回放思考内容(多数中转会拒绝,保持关闭)",
			models: "模型列表",
			modelAdd: "添加模型",
			modelDiscover: "从服务端获取",
			modelDiscoverBusy: "获取中…",
			modelId: "模型 ID",
			modelName: "名称",
			modelContext: "上下文",
			modelMaxTokens: "输出上限",
			modelInput: "输入",
			modelRemove: "删除",
			apply: "保存",
			applying: "保存中…",
			reset: "重置",
			conflict: "设置已被其他页面修改,已重新加载,请重试",
			invalidModel: "模型 {i}:ID 不能为空",
			invalidNumber: "模型 {i}:容量必须是正整数"
		};
		const EN = {
			title: "MMSP route settings",
			key: "API key",
			keySaved: "stored",
			keyMissing: "missing",
			keyPlaceholder: "Leave blank to use the stored credential",
			displayName: "Display name",
			baseURL: "Base URL (MMSP)",
			baseURLHint: "Ends before /stream, e.g. https://go.penguin.ooo/api/v1",
			thinking: "Default thinking level",
			thinkingUnset: "Unset (server default)",
			replay: "Replay thinking (most relays reject it; keep off)",
			models: "Models",
			modelAdd: "Add model",
			modelDiscover: "Fetch from server",
			modelDiscoverBusy: "Fetching…",
			modelId: "Model ID",
			modelName: "Name",
			modelContext: "Context",
			modelMaxTokens: "Max output",
			modelInput: "Input",
			modelRemove: "Remove",
			apply: "Save",
			applying: "Saving…",
			reset: "Reset",
			conflict: "Settings changed elsewhere; reloaded, try again",
			invalidModel: "Model {i}: id is required",
			invalidNumber: "Model {i}: capacities must be positive integers"
		};
		/**
		* One scoped stylesheet mirroring the Models page's own metrics and theme
		* aliases (dsh-client-ui-settings-models' ModelsSection.module.css values);
		* rendered with the card so it unmounts with it.
		*/
		const CARD_CSS = `
/* Hide the page's unknown-layout (disabled) editor only in rows that carry
 * this family's mount point: the row is identified by the slot anchor
 * actually containing this card's mount element, never by the anchor alone —
 * every row renders an empty anchor for unmatched dispatch keys. */
li:has(> div[data-slot="settings.models.provider-card"] > .llmmspc-mount) > div[class*="editor"] { display: none !important; }
li > div[class*="editor"]:has(~ div[data-slot="settings.models.provider-card"] > .llmmspc-mount) { display: none !important; }
.llmmspc-body { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
.llmmspc-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.llmmspc-label { display: inline-flex; align-items: center; gap: 10px; font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.llmmspc-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.llmmspc-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.llmmspc-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.llmmspc-input:disabled { opacity: 0.6; cursor: default; }
select.llmmspc-input { max-width: 240px; cursor: pointer; }
.llmmspc-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.llmmspc-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.llmmspc-btn:disabled { opacity: 0.6; cursor: default; }
.llmmspc-btn-secondary { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); }
.llmmspc-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.llmmspc-btn-sm { height: 28px; padding: 0 10px; font-size: 12px; line-height: 18px; }
.llmmspc-catalog { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.llmmspc-catalog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.llmmspc-catalog-title { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.llmmspc-catalog-actions { display: flex; gap: 6px; }
.llmmspc-list { display: flex; flex-direction: column; gap: 8px; }
.llmmspc-entry { border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-lg); padding: 6px; }
.llmmspc-entry-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 88px 88px auto auto; gap: 6px; align-items: center; }
.llmmspc-chips { display: flex; gap: 10px; align-items: center; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: nowrap; padding: 0 2px; }
.llmmspc-chips label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
.llmmspc-remove { width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; font: inherit; font-size: 14px; }
.llmmspc-remove:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); }
.llmmspc-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.llmmspc-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.llmmspc-footer { display: flex; justify-content: flex-end; gap: 8px; }
`;
		/** Conventional credential reference for a route without a named one. */
		function deriveKeyRef(provider) {
			return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
		}
		/** Fields this card manages; everything else in the profile is never touched. */
		const MANAGED_KEYS = [
			"displayName",
			"baseURL",
			"thinkingLevel",
			"replayThinking",
			"apiKeyEnv",
			"models"
		];
		const THINKING_LEVELS = [
			"none",
			"low",
			"medium",
			"high",
			"xhigh",
			"max"
		];
		/** One editable model row, mirroring the page's model-entry card. */
		function ModelRow({ index, row, disabled, t, onChange, onRemove }) {
			const numberOrEmpty = (value) => value === void 0 ? "" : String(value);
			const positiveInt = (raw) => {
				if (raw === "") return void 0;
				const parsed = Number(raw);
				return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : NaN;
			};
			const inputs = row.input ?? ["text"];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "llmmspc-entry",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "llmmspc-entry-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "llmmspc-input",
							value: row.id ?? "",
							disabled,
							placeholder: t("modelId"),
							"aria-label": `${t("modelId")} ${index + 1}`,
							onChange: (event) => onChange(index, {
								...row,
								id: event.target.value
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "llmmspc-input",
							value: row.name ?? "",
							disabled,
							placeholder: t("modelName"),
							"aria-label": `${t("modelName")} ${index + 1}`,
							onChange: (event) => onChange(index, {
								...row,
								name: event.target.value === "" ? void 0 : event.target.value
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "llmmspc-input",
							inputMode: "numeric",
							value: numberOrEmpty(row.contextWindow),
							disabled,
							placeholder: t("modelContext"),
							"aria-label": `${t("modelContext")} ${index + 1}`,
							onChange: (event) => onChange(index, {
								...row,
								contextWindow: positiveInt(event.target.value)
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "llmmspc-input",
							inputMode: "numeric",
							value: numberOrEmpty(row.maxTokens),
							disabled,
							placeholder: t("modelMaxTokens"),
							"aria-label": `${t("modelMaxTokens")} ${index + 1}`,
							onChange: (event) => onChange(index, {
								...row,
								maxTokens: positiveInt(event.target.value)
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "llmmspc-chips",
							children: ["text", "image"].map((modality) => {
								const checked = inputs.includes(modality);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									disabled,
									checked,
									onChange: (event) => {
										const next = event.target.checked ? inputs.includes("text") ? ["text", "image"] : ["image", "text"] : ["text"];
										onChange(index, {
											...row,
											input: next
										});
									}
								}), modality] }, modality);
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "llmmspc-remove",
							disabled,
							title: t("modelRemove"),
							"aria-label": `${t("modelRemove")} ${index + 1}`,
							onClick: () => onRemove(index),
							children: "✕"
						})
					]
				})
			});
		}
		/** The Models-page card for one MMSP route.
		*
		* Like every other provider row, the fields appear when the row's 编辑 button
		* opens the page's editor; the page's own editor for this family is the
		* unknown-layout card (a hint plus a permanently disabled save), so this
		* component keeps a zero-visibility mount point alive inside the slot anchor
		* at all times, watches the row for that editor appearing, hides it, and
		* renders this family's real editor in its place until the edit closes.
		*/
		function MmspProviderCard({ provider, t, operations }) {
			const route = provider.provider;
			const settingsPath = (0, react.useMemo)(() => [...provider.settingsPath], [provider.settingsPath]);
			const rootRef = (0, react.useRef)(void 0);
			const [editMode, setEditMode] = (0, react.useState)(false);
			const [view, setView] = (0, react.useState)(void 0);
			const [loadError, setLoadError] = (0, react.useState)(void 0);
			const [draft, setDraft] = (0, react.useState)(void 0);
			const [dirty, setDirty] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [keyDraft, setKeyDraft] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [discovering, setDiscovering] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)(void 0);
			const readView = async () => {
				const response = await operations.describeSettings();
				if (!response.ok) {
					setLoadError(response.error.message);
					return;
				}
				const next = response.value.namespaces.find((entry) => entry.ns === NS);
				if (next === void 0) {
					setLoadError(`settings namespace "${NS}" is not mounted`);
					return;
				}
				setLoadError(void 0);
				setView(next);
				const profile = operations.subtreeAt(next, settingsPath);
				setDraft({
					displayName: profile.displayName,
					baseURL: profile.baseURL,
					thinkingLevel: profile.thinkingLevel,
					replayThinking: profile.replayThinking === true,
					apiKeyEnv: profile.apiKeyEnv,
					models: Array.isArray(profile.models) ? profile.models.map((row) => ({ ...row })) : []
				});
				setDirty(/* @__PURE__ */ new Set());
			};
			(0, react.useEffect)(() => {
				readView();
			}, [route, editMode]);
			const rowOf = () => {
				let node = rootRef.current;
				for (let depth = 0; node !== void 0 && node !== null && depth < 4; depth += 1) {
					const parent = node.parentElement;
					if (parent === null) return void 0;
					if (typeof parent.getAttribute === "function" && parent.getAttribute("data-slot") === "settings.models.provider-card") return parent.parentElement ?? void 0;
					node = parent;
				}
			};
			const editorIn = (row) => {
				for (const child of row.children) {
					if (child.tagName !== "DIV") continue;
					if (typeof child.getAttribute === "function" && child.getAttribute("data-slot") !== null) continue;
					if (typeof child.className === "string" && /editor/i.test(child.className)) return child;
				}
			};
			(0, react.useEffect)(() => {
				const row = rowOf();
				if (row === void 0) return void 0;
				let lastPresent = false;
				const reconcile = () => {
					const editor = editorIn(row);
					const present = editor !== void 0;
					if (present) {
						editor.style.display = "none";
						if (!lastPresent) setEditMode(true);
					} else if (lastPresent) setEditMode(false);
					lastPresent = present;
				};
				reconcile();
				const observer = new MutationObserver(reconcile);
				observer.observe(row, { childList: true });
				return () => observer.disconnect();
			}, []);
			const closeHostEditor = () => {
				const row = rowOf();
				if (row === void 0) return false;
				const editor = editorIn(row);
				if (editor === void 0) return false;
				for (const button of editor.querySelectorAll("button")) {
					const label = (button.textContent ?? "").trim();
					if (label === "取消" || label === "Cancel") {
						button.click();
						return true;
					}
				}
				return editor.querySelector("button")?.click() === true;
			};
			const keyRef = draft?.apiKeyEnv !== void 0 && draft.apiKeyEnv !== "" ? draft.apiKeyEnv : deriveKeyRef(route);
			const setField = (key, value) => {
				setDraft((current) => ({
					...current,
					[key]: value
				}));
				setDirty((current) => new Set(current).add(key));
			};
			const rowsInvalid = (draft?.models ?? []).reduce((found, row, index) => {
				if (found !== void 0) return found;
				if (typeof row.id !== "string" || row.id.trim().length === 0) return {
					index,
					kind: "model"
				};
				for (const key of ["contextWindow", "maxTokens"]) {
					const value = row[key];
					if (value !== void 0 && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 1)) return {
						index,
						kind: "number"
					};
				}
			}, void 0);
			const cleanRow = (row) => {
				const next = { id: row.id.trim() };
				if (row.name !== void 0 && row.name !== "") next.name = row.name;
				if (row.contextWindow !== void 0) next.contextWindow = row.contextWindow;
				if (row.maxTokens !== void 0) next.maxTokens = row.maxTokens;
				if (Array.isArray(row.input)) next.input = [...row.input];
				return next;
			};
			const apply = async () => {
				if (busy || view === void 0 || draft === void 0) return;
				setBusy(true);
				setFailure(void 0);
				try {
					const committed = operations.subtreeAt(view, settingsPath);
					const ops = [];
					for (const key of MANAGED_KEYS) {
						if (!dirty.has(key)) continue;
						const after = key === "models" ? draft.models.map(cleanRow) : draft[key];
						if (JSON.stringify(committed?.[key]) === JSON.stringify(after)) continue;
						const clears = after === void 0 || key === "replayThinking" && after === false;
						if (clears && committed?.[key] === void 0) continue;
						if (clears) ops.push({
							op: "unset",
							path: [...settingsPath, key]
						});
						else ops.push({
							op: "set",
							path: [...settingsPath, key],
							value: after
						});
					}
					if (ops.length > 0) {
						const written = await operations.writeSettings(NS, ops, view.revision);
						if (!written.ok) {
							setFailure(written.error.code === "settings/conflict" ? t("conflict") : written.error.message);
							if (written.error.code === "settings/conflict") await readView();
							return;
						}
						setView(written.value);
					}
					if (keyDraft.trim().length > 0) {
						const stored = await operations.storeCredential(keyRef, keyDraft.trim());
						if (stored !== void 0) {
							setFailure(stored);
							return;
						}
					}
					setKeyDraft("");
					setDirty(/* @__PURE__ */ new Set());
					closeHostEditor();
				} finally {
					setBusy(false);
				}
			};
			const discover = async () => {
				if (discovering) return;
				setDiscovering(true);
				setFailure(void 0);
				try {
					const answer = await operations.discoverModels(NS, { provider: route });
					if (!answer.ok) {
						setFailure(answer.error.message);
						return;
					}
					setDraft((current) => ({
						...current,
						models: answer.value.map((model) => ({
							id: model.id,
							...model.name === void 0 ? {} : { name: model.name },
							...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
							...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
							...model.inputModalities === void 0 ? {} : { input: [...model.inputModalities] }
						}))
					}));
					setDirty((current) => new Set(current).add("models"));
				} finally {
					setDiscovering(false);
				}
			};
			if (!editMode) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: "llmmspc-mount"
			});
			const disabled = busy || view === void 0;
			const editRow = (index, next) => {
				setDraft((current) => {
					const models = [...current.models];
					models[index] = next;
					return {
						...current,
						models
					};
				});
				setDirty((current) => new Set(current).add("models"));
			};
			const removeRow = (index) => {
				setDraft((current) => ({
					...current,
					models: current.models.filter((_, at) => at !== index)
				}));
				setDirty((current) => new Set(current).add("models"));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: "llmmspc-mount",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: CARD_CSS }),
					loadError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "llmmspc-error",
						children: `${route}: ${loadError}`
					}) : null,
					draft === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "llmmspc-body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "llmmspc-field",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "llmmspc-label",
										children: t("key")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "llmmspc-input",
										type: "password",
										autoComplete: "off",
										value: keyDraft,
										disabled,
										placeholder: t("keyPlaceholder"),
										onChange: (event) => setKeyDraft(event.target.value)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "llmmspc-hint",
										children: `存储为凭据 ${keyRef}`
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "llmmspc-field",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "llmmspc-label",
										children: t("baseURL")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "llmmspc-input",
										value: draft.baseURL ?? "",
										disabled,
										onChange: (event) => setField("baseURL", event.target.value === "" ? void 0 : event.target.value)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "llmmspc-hint",
										children: t("baseURLHint")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "llmmspc-row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "llmmspc-field",
										style: { width: 220 },
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "llmmspc-label",
											children: t("displayName")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "llmmspc-input",
											value: draft.displayName ?? "",
											disabled,
											onChange: (event) => setField("displayName", event.target.value === "" ? void 0 : event.target.value)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "llmmspc-field",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "llmmspc-label",
											children: t("thinking")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											className: "llmmspc-input",
											value: draft.thinkingLevel ?? "",
											disabled,
											onChange: (event) => setField("thinkingLevel", event.target.value === "" ? void 0 : event.target.value),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "",
												children: t("thinkingUnset")
											}), THINKING_LEVELS.map((level) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: level,
												children: level
											}, level))]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "llmmspc-label",
										style: {
											cursor: "pointer",
											paddingBottom: 7
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: draft.replayThinking === true,
											disabled,
											onChange: (event) => setField("replayThinking", event.target.checked ? true : void 0)
										}), t("replay")]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "llmmspc-catalog",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "llmmspc-catalog-head",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "llmmspc-catalog-title",
											children: `${t("models")} (${draft.models.length})`
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "llmmspc-catalog-actions",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "llmmspc-btn llmmspc-btn-secondary llmmspc-btn-sm",
												disabled: disabled || discovering,
												onClick: () => {
													discover();
												},
												children: discovering ? t("modelDiscoverBusy") : t("modelDiscover")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "llmmspc-btn llmmspc-btn-secondary llmmspc-btn-sm",
												disabled,
												onClick: () => {
													setDraft((current) => ({
														...current,
														models: [...current.models, { id: "" }]
													}));
													setDirty((current) => new Set(current).add("models"));
												},
												children: t("modelAdd")
											})]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "llmmspc-list",
										children: draft.models.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {
											index,
											row,
											disabled,
											t,
											onChange: editRow,
											onRemove: removeRow
										}, index))
									}),
									rowsInvalid !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										role: "alert",
										className: "llmmspc-error",
										children: rowsInvalid.kind === "model" ? t("invalidModel").replace("{i}", String(rowsInvalid.index + 1)) : t("invalidNumber").replace("{i}", String(rowsInvalid.index + 1))
									}) : null
								]
							}),
							failure === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								className: "llmmspc-error",
								children: failure
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "llmmspc-footer",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "llmmspc-btn llmmspc-btn-secondary",
									disabled,
									onClick: () => {
										readView();
									},
									children: t("reset")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "llmmspc-btn llmmspc-btn-primary",
									disabled: disabled || rowsInvalid !== void 0,
									onClick: () => {
										apply();
									},
									children: busy ? t("applying") : t("apply")
								})]
							})
						]
					})
				]
			});
		}
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.llm",
			"remote.settings",
			"remote.credentials"
		];
		function apply(ctx) {
			const t = ctx.locale.bind(`${NS}.card`);
			ctx.effect(() => ctx.locale.register(`${NS}.card`, {
				zh: ZH,
				en: EN
			}), "llm-mmsp: card copy dictionaries");
			const operations = {
				describeSettings: async () => ctx.remote.settings.describe(),
				writeSettings: async (ns, pathOps, expectedRevision) => ctx.remote.settings.mutate(ns, pathOps, expectedRevision),
				storeCredential: async (ref, value) => {
					const response = await ctx.remote.credentials.set(ref, value);
					return response.ok ? void 0 : response.error.message;
				},
				discoverModels: async (settingsNs, request) => ctx.remote.llm.discoverModels(settingsNs, request),
				subtreeAt: (view, path) => {
					let node = view.user;
					for (const key of path) node = node !== null && typeof node === "object" ? node[key] : void 0;
					if (node !== void 0) return node;
					node = view.base;
					for (const key of path) node = node !== null && typeof node === "object" ? node[key] : void 0;
					if (node !== void 0) return node;
					node = view.value;
					for (const key of path) node = node !== null && typeof node === "object" ? node[key] : void 0;
					return typeof node === "object" && node !== null ? node : {};
				}
			};
			ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
				name: "settings.models.provider-card",
				key: NS
			}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MmspProviderCard, {
				...props,
				t,
				operations
			})));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map