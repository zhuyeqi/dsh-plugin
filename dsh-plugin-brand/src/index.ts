/**
 * Host entry for the configurable brand-name plugin.
 *
 * One cordis row, named after this package so `dsh-client-modules` can
 * discover `dsh.client` and serve `/plugins/dsh-plugin-brand/client.js`.
 *
 * The host half only owns configuration: it registers the `brand` settings
 * namespace whose resolved `name` the browser half renders in the sidebar
 * brand seat. Layering (per the settings service):
 *
 *   schema default  <  composition `base` (this row's `defaultName`)  <  user layer
 *
 * so a fresh deployment shows `defaultName`, a user override in Settings →
 * General wins live and persists in the settings document, and a reset
 * (unset) falls back to `defaultName`.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';

export const name = 'dsh-plugin-brand';

/** The settings transport owns the namespace lifecycle; wait for it. */
export const inject = ['settings'];

/** Row configuration (cordis.patch.yml `config:`). */
export interface BrandRowConfig {
  /** Composition-layer brand name; the reset target for user overrides. */
  defaultName: string;
}

export const Config = z.object({
  defaultName: z.string().min(1).default('KK'),
});

/** The resolved `brand` namespace section the client renders. */
export interface BrandSection {
  name: string;
}

const BRAND_NAMESPACE = 'brand' as SettingsNamespace;

const BRAND_SCHEMA = z.object({
  name: z.string().min(1).default('KK'),
});

export function apply(ctx: Context, config: BrandRowConfig): void {
  // Fiber-scoped: disposing this plugin's fiber removes the namespace.
  ctx.settings.register<BrandSection>(BRAND_NAMESPACE, BRAND_SCHEMA, {
    base: { name: config.defaultName },
    applies: 'live',
  });
}
