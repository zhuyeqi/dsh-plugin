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
import { createElement as h, useSyncExternalStore, useState } from 'react';

export const name = 'dsh-plugin-brand';

/** Both seats are hard dependencies: nothing to render without them. */
export const inject = ['slots', 'settingsScope'];

/** The `brand` namespace section as the browser consumes it. */
interface BrandSection {
  name: string;
}

/** Client sync state of one settings namespace (dsh-client-runtime contract). */
interface BrandSnapshot {
  status: 'loading' | 'ready' | 'unavailable';
  value: BrandSection | undefined;
  base: unknown;
  user: unknown;
  revision: number | undefined;
  writable: boolean;
  mode: 'host' | 'memory';
}

/** Reactive owner handle over the namespace (dsh-client-runtime contract). */
interface BrandScope {
  getSnapshot(): BrandSnapshot;
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<void>;
  unset(field: string): Promise<void>;
}

/** The settings domain's base service face this plugin consumes. */
interface SettingsScopeBinder {
  bind(spec: {
    namespace: string;
    decode?: (section: unknown) => BrandSection | undefined;
  }): BrandScope;
}

interface SlotsFace {
  inject(name: string, register: () => unknown): void;
  register(options: Record<string, unknown>, render: (props: unknown) => unknown): unknown;
}

interface BrandClientContext {
  slots: SlotsFace;
  settingsScope: SettingsScopeBinder;
}

/** Fallback when nothing has resolved yet; matches the composition default. */
const FALLBACK_NAME = 'KK';

function decodeBrandSection(section: unknown): BrandSection | undefined {
  if (typeof section !== 'object' || section === null) return undefined;
  const record = section as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.length === 0) return undefined;
  return { name: record.name };
}

function nameFromLayer(layer: unknown): string | undefined {
  return decodeBrandSection(layer)?.name;
}

/** One subscription-shared hook over the scope's snapshot. */
function useBrandSnapshot(scope: BrandScope): BrandSnapshot {
  // Arrow wrappers keep the controller's `this` bound through the closure —
  // passing the bare methods would lose it and crash reading private state.
  return useSyncExternalStore(
    (listener: () => void) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  );
}

function BrandName({ scope }: { scope: BrandScope }) {
  const snapshot = useBrandSnapshot(scope);
  const text = snapshot.value?.name ?? nameFromLayer(snapshot.base) ?? FALLBACK_NAME;
  return h(
    'span',
    {
      style: {
        fontSize: '15px',
        fontWeight: 600,
        lineHeight: '24px',
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      },
    },
    text,
  );
}

const ROW_STYLE: Record<string, string | number> = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 0',
  borderBottom: '1px solid var(--dsh-border, rgba(128, 128, 128, 0.25))',
};

const LABEL_STYLE: Record<string, string | number> = {
  flex: '0 0 auto',
  minWidth: '120px',
  fontSize: '13px',
  fontWeight: 500,
};

const INPUT_STYLE: Record<string, string | number> = {
  flex: '1 1 auto',
  minWidth: '0',
  fontSize: '13px',
  padding: '4px 8px',
  borderRadius: '6px',
  border: '1px solid var(--dsh-border, rgba(128, 128, 128, 0.35))',
  background: 'transparent',
  color: 'inherit',
};

const BUTTON_STYLE: Record<string, string | number> = {
  flex: '0 0 auto',
  fontSize: '12px',
  padding: '4px 10px',
  borderRadius: '6px',
  border: '1px solid var(--dsh-border, rgba(128, 128, 128, 0.35))',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

function BrandNameRow({ scope }: { scope: BrandScope }) {
  const snapshot = useBrandSnapshot(scope);
  const current = snapshot.value?.name ?? nameFromLayer(snapshot.base) ?? FALLBACK_NAME;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overridden =
    typeof snapshot.user === 'object' && snapshot.user !== null && 'name' in snapshot.user;
  const editable = snapshot.writable && snapshot.status !== 'unavailable' && !busy;
  const value = draft ?? current;
  const trimmed = value.trim();
  const dirty = draft !== null && trimmed.length > 0 && trimmed !== current;

  async function save(): Promise<void> {
    if (!dirty) return;
    setBusy(true);
    setError(null);
    try {
      await scope.set('name', trimmed);
      setDraft(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function reset(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await scope.unset('name');
      setDraft(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return h(
    'div',
    { style: ROW_STYLE },
    h('label', { style: LABEL_STYLE }, '品牌名 Brand name'),
    h('input', {
      style: INPUT_STYLE,
      type: 'text',
      value,
      disabled: !editable,
      maxLength: 40,
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
      onKeyDown: (event: { key: string; preventDefault: () => void }) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void save();
        }
      },
    }),
    h(
      'button',
      {
        type: 'button',
        style: { ...BUTTON_STYLE, opacity: dirty && editable ? '1' : '0.5' },
        disabled: !(dirty && editable),
        onClick: () => void save(),
      },
      busy ? '…' : '保存',
    ),
    overridden
      ? h(
          'button',
          {
            type: 'button',
            style: { ...BUTTON_STYLE, opacity: editable ? '1' : '0.5' },
            disabled: !editable,
            onClick: () => void reset(),
          },
          '重置',
        )
      : null,
    error !== null ? h('span', { style: { fontSize: '12px', color: '#e5484d' } }, error) : null,
    snapshot.status === 'unavailable'
      ? h('span', { style: { fontSize: '12px', opacity: '0.7' } }, '设置暂不可用')
      : null,
  );
}

export function apply(ctx: BrandClientContext): void {
  const scope = ctx.settingsScope.bind({ namespace: 'brand', decode: decodeBrandSection });

  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register(
      // Priority -1 shadows the official wordmark occupant (registered at the
      // default 0 by dsh-client-ui-brand-official); the lowest priority renders.
      { name: 'sidebar.brand.name', priority: -1 },
      () => h(BrandName, { scope }),
    ),
  );

  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register(
      {
        name: 'settings.general.item',
        id: 'brand',
        order: 60,
        label: '品牌名 Brand name',
      },
      () => h(BrandNameRow, { scope }),
    ),
  );
}
