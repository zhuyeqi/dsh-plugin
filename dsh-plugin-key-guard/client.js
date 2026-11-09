/**
 * Browser half of key-guard: a Settings section that edits the plugin's
 * volatile config (mode / patterns / exactKeys) through the shared
 * `configForms` service — staged edits, revision-fenced save, secrets never
 * ride a response (exactKeys shows only how many are stored).
 */
window.__ModuleLoader__.load({
  id: '@zhuyeqi/dsh-plugin-key-guard',
  factory(require) {
    const React = require('react');
    const { SettingsForm, SettingsFormModel } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;

    const NS = 'key-guard';

    const DICTS = {
      zh: {
        nav: '密钥守卫',
        title: '密钥守卫',
        intro: '模型请求发出前自动把 AI/大模型 Key 替换为占位符，模型返回使用时在本地还原；真实密钥不会到达模型服务商。',
        mode: '脱敏模式',
        modeHint: '占位符：返回时本地还原为真实密钥；永久遮蔽：替换为 <<REDACTED>>，永不还原。',
        modePlaceholder: '占位符（可还原）',
        modeRedact: '永久遮蔽（不还原）',
        patterns: '自定义正则（每行一条）',
        patternsHint: '忽略大小写的正则源码，如 MyCorp-[A-Za-z0-9]{8}；留空保存即清空。',
        exactKeys: '精确密钥（每行一条）',
        exactKeysHint: '无格式特征的固定密钥；保存后不再回显，只显示条数。留空保存即清空。',
        exactConfigured: '已配置 {n} 条密钥',
        exactNone: '尚未配置精确密钥',
        overridden: '已覆盖',
        reset: '重置',
        save: '保存',
        saving: '保存中…',
        saveFailed: '宿主未接受这些值，已保留供修改。',
        unavailable: '该插件当前未加载，暂时无法配置。',
        readOnly: '本部署的设置为只读。',
      },
      en: {
        nav: 'Key guard',
        title: 'Key guard',
        intro: 'Masks AI/LLM keys as placeholders before any model request and restores them locally when the model uses them; real keys never reach a provider.',
        mode: 'Masking mode',
        modeHint: 'Placeholder restores real keys from replies; redact replaces with <<REDACTED>> and never restores.',
        modePlaceholder: 'Placeholder (restorable)',
        modeRedact: 'Redact (never restored)',
        patterns: 'Custom regexes (one per line)',
        patternsHint: 'Case-insensitive regex sources, e.g. MyCorp-[A-Za-z0-9]{8}. Save empty to clear.',
        exactKeys: 'Exact secrets (one per line)',
        exactKeysHint: 'Format-free fixed secrets; never echoed back after saving, only a count is shown. Save empty to clear.',
        exactConfigured: '{n} secret(s) configured',
        exactNone: 'No exact secrets configured',
        overridden: 'Overridden',
        reset: 'Reset',
        save: 'Save',
        saving: 'Saving…',
        saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
        unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
        readOnly: 'This deployment stores settings read-only.',
      },
    };

    // ---- field specs over the plugin's volatile config --------------------

    const modeSpec = {
      field: 'mode',
      format: (value) => (value === 'redact' ? 'redact' : 'placeholder'),
      parse: (text) => (text === 'placeholder' || text === 'redact' ? { kind: 'set', value: text } : undefined),
    };

    function linesSpec(field) {
      return {
        field,
        format: (value) => (Array.isArray(value)
          ? value.filter((entry) => typeof entry === 'string' && entry.length > 0).join('\n')
          : ''),
        parse: (text) => ({
          kind: 'set',
          value: text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0),
        }),
      };
    }

    // ---- styles ------------------------------------------------------------

    const css = `
.kguard-section{max-width:760px;color:var(--dsh-alias-label-primary,var(--dsw-alias-label-primary));display:flex;flex-direction:column;gap:12px}
.kguard-heading{margin:0;font-size:18px;font-weight:600}
.kguard-intro{color:var(--dsh-alias-label-tertiary,var(--dsw-alias-label-tertiary));margin:0;font-size:13px;line-height:1.6}
.kguard-field{display:flex;flex-direction:column;gap:6px}
.kguard-labelrow{display:flex;align-items:center;gap:8px;font-size:13px}
.kguard-label{font-weight:600}
.kguard-badge{color:var(--dsh-alias-label-tertiary,var(--dsw-alias-label-tertiary));font-size:11px;border:0.5px solid var(--dsh-alias-border-l2,var(--dsw-alias-border-l2));border-radius:4px;padding:1px 6px}
.kguard-reset{font:inherit;font-size:12px;color:var(--dsh-alias-link,var(--dsw-alias-link));background:0;border:0;cursor:pointer;padding:0}
.kguard-hint{color:var(--dsh-alias-label-tertiary,var(--dsw-alias-label-tertiary));margin:0;font-size:12px;line-height:1.5}
.kguard-select{font:inherit;font-size:13px;padding:6px 8px;border:0.5px solid var(--dsh-alias-border-l2,var(--dsw-alias-border-l2));border-radius:6px;background:var(--dsh-alias-fill-secondary,var(--dsw-alias-fill-secondary));color:inherit}
.kguard-textarea{font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;padding:8px 10px;border:0.5px solid var(--dsh-alias-border-l2,var(--dsw-alias-border-l2));border-radius:6px;background:var(--dsh-alias-fill-secondary,var(--dsw-alias-fill-secondary));color:inherit;min-height:72px;resize:vertical}
.kguard-count{font-size:12px;color:var(--dsh-alias-label-tertiary,var(--dsw-alias-label-tertiary))}
`;
    const cssTagId = '@zhuyeqi/dsh-plugin-key-guard/client.css';
    function ensureStyles() {
      try {
        if (typeof document !== 'undefined' && !document.querySelector(`style[data-plugin-css=${JSON.stringify(cssTagId)}]`)) {
          const tag = document.createElement('style');
          tag.dataset.pluginCss = cssTagId;
          tag.textContent = css;
          document.head.appendChild(tag);
        }
      } catch { /* styles are cosmetic */ }
    }

    // ---- card component ------------------------------------------------------

    function fill(template, vars) {
      return template.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
    }

    function KeyGuardCard(props) {
      const { t, store, actions } = props;
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
      const shell = state.shell;
      const disabled = !shell.writable || shell.saving;

      const overriddenBadge = (field) => (
        state[field].overridden
          ? h('span', { key: `b-${field}`, className: 'kguard-badge' }, t('overridden'))
          : null
      );
      const resetLink = (field) => (
        state[field].overridden
          ? h('button', {
            key: `r-${field}`, type: 'button', className: 'kguard-reset',
            disabled,
            onClick: () => actions.resetField(field),
          }, t('reset'))
          : null
      );

      return h(SettingsForm, {
        labels: {
          unavailable: t('unavailable'),
          readOnly: t('readOnly'),
          saveFailed: t('saveFailed'),
          save: t('save'),
          saving: t('saving'),
        },
        state: shell,
        onSave: actions.save,
        onDiscard: actions.discard,
        children: [
          h('div', { key: 'mode', className: 'kguard-field' }, [
            h('div', { key: 'l', className: 'kguard-labelrow' }, [
              h('span', { className: 'kguard-label' }, t('mode')),
              overriddenBadge('mode'),
              resetLink('mode'),
            ]),
            h('select', {
              key: 's',
              className: 'kguard-select',
              value: state.mode.text || 'placeholder',
              disabled,
              onChange: (event) => actions.edit('mode', event.target.value),
            }, [
              h('option', { key: 'p', value: 'placeholder' }, t('modePlaceholder')),
              h('option', { key: 'r', value: 'redact' }, t('modeRedact')),
            ]),
            h('p', { key: 'h', className: 'kguard-hint' }, t('modeHint')),
          ]),

          h('div', { key: 'patterns', className: 'kguard-field' }, [
            h('div', { key: 'l', className: 'kguard-labelrow' }, [
              h('span', { className: 'kguard-label' }, t('patterns')),
              overriddenBadge('patterns'),
              resetLink('patterns'),
            ]),
            h('textarea', {
              key: 'a',
              className: 'kguard-textarea',
              value: state.patterns.text,
              disabled,
              spellCheck: false,
              placeholder: 'MyCorp-[A-Za-z0-9]{8,}',
              onChange: (event) => actions.edit('patterns', event.target.value),
            }),
            h('p', { key: 'h', className: 'kguard-hint' }, t('patternsHint')),
          ]),

          h('div', { key: 'exactKeys', className: 'kguard-field' }, [
            h('div', { key: 'l', className: 'kguard-labelrow' }, [
              h('span', { className: 'kguard-label' }, t('exactKeys')),
              overriddenBadge('exactKeys'),
              resetLink('exactKeys'),
            ]),
            h('p', { key: 'c', className: 'kguard-count' }, state.exactCount > 0
              ? fill(t('exactConfigured'), { n: state.exactCount })
              : t('exactNone')),
            h('textarea', {
              key: 'a',
              className: 'kguard-textarea',
              value: state.exactKeys.text,
              disabled,
              spellCheck: false,
              autoComplete: 'off',
              onChange: (event) => actions.edit('exactKeys', event.target.value),
            }),
            h('p', { key: 'h', className: 'kguard-hint' }, t('exactKeysHint')),
          ]),
        ],
      });
    }

    function KeyGuardSection({ t, store, actions }) {
      ensureStyles();
      return h('div', { className: 'kguard-section' }, [
        h('h2', { key: 'h', className: 'kguard-heading' }, t('title')),
        h('p', { key: 'i', className: 'kguard-intro' }, t('intro')),
        h(KeyGuardCard, { key: 'c', t, store, actions }),
      ]);
    }

    // ---- plugin entry --------------------------------------------------------

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => {
        const offZh = ctx.locale.register(NS, 'zh', DICTS.zh);
        const offEn = ctx.locale.register(NS, 'en', DICTS.en);
        return () => { offZh(); offEn(); };
      }, 'key-guard: client dictionaries');

      const scope = ctx.configForms.get(NS);
      const form = new SettingsFormModel(scope, [modeSpec, linesSpec('patterns'), linesSpec('exactKeys')]);
      ctx.effect(() => () => form.dispose(), 'key-guard: settings form');

      const store = form.bind(() => {
        const snapshot = scope.getSnapshot();
        const exact = Array.isArray(snapshot.value?.exactKeys) ? snapshot.value.exactKeys.length : 0;
        return {
          shell: form.shell(),
          mode: form.field('mode'),
          patterns: form.field('patterns'),
          exactKeys: form.field('exactKeys'),
          exactCount: exact,
        };
      });
      const actions = form.actions();

      ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'key-guard',
        order: 55,
        label: () => t('nav'),
        locale: NS,
      }, () => h(KeyGuardSection, { t, store, actions })))), 'key-guard: settings section');
    }

    return { apply, inject: ['slots', 'locale', 'configForms'] };
  },
});
