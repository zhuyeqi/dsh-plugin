import z from "@deepseek-ai/schemastery";
//#region src/index.ts
const name = "dsh-plugin-brand";
/** The settings transport owns the namespace lifecycle; wait for it. */
const inject = ["settings"];
const Config = z.object({ defaultName: z.string().min(1).default("KK") });
const BRAND_NAMESPACE = "brand";
const BRAND_SCHEMA = z.object({ name: z.string().min(1).default("KK") });
function apply(ctx, config) {
	ctx.settings.register(BRAND_NAMESPACE, BRAND_SCHEMA, {
		base: { name: config.defaultName },
		applies: "live"
	});
}
//#endregion
export { Config, apply, inject, name };
