window.__ModuleLoader__.load({
	id: "dsh-plugin-brand",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client.ts
		/**
		* Browser entry: the configurable brand name.
		* tsdown wraps this file in window.__ModuleLoader__.load({ id, factory }).
		*
		* Two seats:
		*   - `sidebar.brand.name` — renders the resolved brand name (single slot,
		*     replacing the official wordmark occupant exactly like the official
		*     brand plugin does).
		*   - `settings.general.item` — one compact row in Settings → General that
		*     edits the `brand` namespace live through the client settings scope.
		*/
		const name = "dsh-plugin-brand";
		/** Both seats are hard dependencies: nothing to render without them. */
		const inject = ["slots", "settingsScope"];
		/** Fallback when nothing has resolved yet; matches the composition default. */
		const FALLBACK_NAME = "KK";
		function decodeBrandSection(section) {
			if (typeof section !== "object" || section === null) return void 0;
			const record = section;
			if (typeof record.name !== "string" || record.name.length === 0) return void 0;
			return { name: record.name };
		}
		function nameFromLayer(layer) {
			return decodeBrandSection(layer)?.name;
		}
		/** One subscription-shared hook over the scope's snapshot. */
		function useBrandSnapshot(scope) {
			return (0, react.useSyncExternalStore)((listener) => scope.subscribe(listener), () => scope.getSnapshot());
		}
		function BrandName({ scope }) {
			const snapshot = useBrandSnapshot(scope);
			const text = snapshot.value?.name ?? nameFromLayer(snapshot.base) ?? FALLBACK_NAME;
			return (0, react.createElement)("span", { style: {
				fontSize: "15px",
				fontWeight: 600,
				lineHeight: "24px",
				letterSpacing: "0.01em",
				whiteSpace: "nowrap",
				userSelect: "none"
			} }, text);
		}
		const ROW_STYLE = {
			display: "flex",
			alignItems: "center",
			gap: "10px",
			padding: "10px 0",
			borderBottom: "1px solid var(--dsh-border, rgba(128, 128, 128, 0.25))"
		};
		const LABEL_STYLE = {
			flex: "0 0 auto",
			minWidth: "120px",
			fontSize: "13px",
			fontWeight: 500
		};
		const INPUT_STYLE = {
			flex: "1 1 auto",
			minWidth: "0",
			fontSize: "13px",
			padding: "4px 8px",
			borderRadius: "6px",
			border: "1px solid var(--dsh-border, rgba(128, 128, 128, 0.35))",
			background: "transparent",
			color: "inherit"
		};
		const BUTTON_STYLE = {
			flex: "0 0 auto",
			fontSize: "12px",
			padding: "4px 10px",
			borderRadius: "6px",
			border: "1px solid var(--dsh-border, rgba(128, 128, 128, 0.35))",
			background: "transparent",
			color: "inherit",
			cursor: "pointer"
		};
		function BrandNameRow({ scope }) {
			const snapshot = useBrandSnapshot(scope);
			const current = snapshot.value?.name ?? nameFromLayer(snapshot.base) ?? FALLBACK_NAME;
			const [draft, setDraft] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const overridden = typeof snapshot.user === "object" && snapshot.user !== null && "name" in snapshot.user;
			const editable = snapshot.writable && snapshot.status !== "unavailable" && !busy;
			const value = draft ?? current;
			const trimmed = value.trim();
			const dirty = draft !== null && trimmed.length > 0 && trimmed !== current;
			async function save() {
				if (!dirty) return;
				setBusy(true);
				setError(null);
				try {
					await scope.set("name", trimmed);
					setDraft(null);
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					setBusy(false);
				}
			}
			async function reset() {
				setBusy(true);
				setError(null);
				try {
					await scope.unset("name");
					setDraft(null);
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					setBusy(false);
				}
			}
			return (0, react.createElement)("div", { style: ROW_STYLE }, (0, react.createElement)("label", { style: LABEL_STYLE }, "品牌名 Brand name"), (0, react.createElement)("input", {
				style: INPUT_STYLE,
				type: "text",
				value,
				disabled: !editable,
				maxLength: 40,
				onChange: (event) => setDraft(event.target.value),
				onKeyDown: (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						save();
					}
				}
			}), (0, react.createElement)("button", {
				type: "button",
				style: {
					...BUTTON_STYLE,
					opacity: dirty && editable ? "1" : "0.5"
				},
				disabled: !(dirty && editable),
				onClick: () => void save()
			}, busy ? "…" : "保存"), overridden ? (0, react.createElement)("button", {
				type: "button",
				style: {
					...BUTTON_STYLE,
					opacity: editable ? "1" : "0.5"
				},
				disabled: !editable,
				onClick: () => void reset()
			}, "重置") : null, error !== null ? (0, react.createElement)("span", { style: {
				fontSize: "12px",
				color: "#e5484d"
			} }, error) : null, snapshot.status === "unavailable" ? (0, react.createElement)("span", { style: {
				fontSize: "12px",
				opacity: "0.7"
			} }, "设置暂不可用") : null);
		}
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({
				namespace: "brand",
				decode: decodeBrandSection
			});
			ctx.slots.inject("sidebar.brand.name", () => ctx.slots.register({
				name: "sidebar.brand.name",
				priority: -1
			}, () => (0, react.createElement)(BrandName, { scope })));
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "brand",
				order: 60,
				label: "品牌名 Brand name"
			}, () => (0, react.createElement)(BrandNameRow, { scope })));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map