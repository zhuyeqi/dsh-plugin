window.__ModuleLoader__.load({
  id: '@zhuyeqi/dsh-plugin-water-reminder',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ------------------------------------------------------------------
    // i18n dictionaries, registered into the Client locale service.
    // ------------------------------------------------------------------
    const DICTS = {
      en: {
        'dock.cups': 'cups today',
        'dock.next': 'Next reminder',
        'dock.due': 'Time to drink water!',
        'dock.paused': 'Paused',
        'dock.drink': '+1 cup',
        'dock.pause': 'Pause',
        'dock.resume': 'Resume',
        'overlay.title': 'Time to drink water 💧',
        'overlay.body': 'One cup now keeps you sharp. Today:',
        'overlay.done': 'Done, +1 cup',
        'overlay.snooze': '5 min later',
        'overlay.later': 'Dismiss (remind in 10 min)',
        'notified.title': 'Time to drink water 💧',
        'notified.body': 'The reminder card is waiting in the app.',
      },
      zh: {
        'dock.cups': '今日喝水',
        'dock.next': '下次提醒',
        'dock.due': '该喝水啦！',
        'dock.paused': '已暂停',
        'dock.drink': '+一杯',
        'dock.pause': '暂停',
        'dock.resume': '继续',
        'overlay.title': '该喝水啦 💧',
        'overlay.body': '现在来一杯，保持状态。今日进度：',
        'overlay.done': '喝好了，+一杯',
        'overlay.snooze': '5分钟后再提醒',
        'overlay.later': '先关掉（10分钟后再提醒）',
        'notified.title': '该喝水啦 💧',
        'notified.body': '提醒卡片正在应用里等你。',
      },
    };

    let localeSvc = null;

    // Fallback dictionary when the locale service is unavailable: follow the
    // active locale id, defaulting to Chinese for an unknown or missing one.
    function fallbackDict() {
      let id = '';
      try {
        if (localeSvc && typeof localeSvc.getLocale === 'function') {
          const snap = localeSvc.getLocale();
          if (snap && typeof snap === 'object') id = String(snap.id || snap.locale || '');
        }
      } catch (e) { /* keep the default */ }
      return id && !/^zh/i.test(id) ? DICTS.en : DICTS.zh;
    }

    function makeT() {
      if (localeSvc && typeof localeSvc.bind === 'function') {
        try {
          const t = localeSvc.bind('water-reminder');
          if (typeof t === 'function') return t;
        } catch (e) { /* fall through to the built-in dictionary */ }
      }
      const dict = fallbackDict();
      return (key) => (dict[key] !== undefined ? dict[key] : key);
    }

    function useT() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        if (!localeSvc || typeof localeSvc.subscribe !== 'function') return undefined;
        return localeSvc.subscribe(() => bump((n) => n + 1));
      }, []);
      return makeT();
    }

    // ------------------------------------------------------------------
    // Reminder state, persisted in localStorage under a versioned key.
    // ------------------------------------------------------------------
    const STORAGE_KEY = 'water-reminder.v1';
    const DEFAULT_INTERVAL_MIN = 45;
    const DEFAULT_GOAL = 8;

    function todayKey(d) {
      const date = d || new Date();
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    function loadState() {
      const now = Date.now();
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { saved = null; }

      const intervalMin = saved && Number.isFinite(saved.intervalMin)
        ? Math.min(180, Math.max(5, saved.intervalMin)) : DEFAULT_INTERVAL_MIN;
      const goal = saved && Number.isFinite(saved.goal)
        ? Math.min(20, Math.max(1, saved.goal)) : DEFAULT_GOAL;
      const enabled = saved ? saved.enabled !== false : true;

      const cups = {};
      if (saved && saved.cups && typeof saved.cups === 'object') {
        for (let i = 0; i < 7; i += 1) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const k = todayKey(d);
          if (Number.isFinite(saved.cups[k])) cups[k] = saved.cups[k];
        }
      }
      const today = todayKey();
      if (!Number.isFinite(cups[today])) cups[today] = 0;

      const nextAt = saved && Number.isFinite(saved.nextAt)
        ? saved.nextAt
        : now + intervalMin * 60000;

      return { now, intervalMin, goal, enabled, cups, nextAt, due: false };
    }

    function requestNotifyPermission() {
      try {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
          const p = Notification.requestPermission();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch (e) { /* notifications unsupported: the in-app card still works */ }
    }

    function fireNotification(t) {
      try {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        if (document.visibilityState !== 'hidden') return;
        if (Notification.permission !== 'granted') return;
        const n = new Notification(t('notified.title'), {
          body: t('notified.body'),
          tag: 'water-reminder',
        });
        n.addEventListener('click', () => {
          try { window.focus(); n.close(); } catch (e) { /* noop */ }
        });
      } catch (e) { /* noop */ }
    }

    const store = {
      state: loadState(),
      listeners: new Set(),

      subscribe(fn) {
        this.listeners.add(fn);
        fn(this.state);
        return () => { this.listeners.delete(fn); };
      },

      emit() {
        for (const fn of this.listeners) fn(this.state);
      },

      patch(partial, persist) {
        this.state = { ...this.state, ...partial };
        if (persist) this.save();
        this.emit();
      },

      save() {
        const s = this.state;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            enabled: s.enabled,
            intervalMin: s.intervalMin,
            goal: s.goal,
            cups: s.cups,
            nextAt: s.nextAt,
          }));
        } catch (e) { /* storage unavailable: state stays in memory */ }
      },

      tick() {
        const now = Date.now();
        const partial = { now };
        if (this.state.enabled && !this.state.due && now >= this.state.nextAt) {
          partial.due = true;
          fireNotification(makeT());
        }
        this.patch(partial, false);
      },

      drink() {
        const today = todayKey();
        const cups = { ...this.state.cups, [today]: (this.state.cups[today] || 0) + 1 };
        this.patch({
          cups,
          nextAt: Date.now() + this.state.intervalMin * 60000,
          due: false,
        }, true);
      },

      snooze(min) {
        this.patch({ nextAt: Date.now() + min * 60000, due: false }, true);
      },

      setEnabled(value) {
        if (value) {
          this.patch({
            enabled: true,
            nextAt: Date.now() + this.state.intervalMin * 60000,
            due: false,
          }, true);
        } else {
          this.patch({ enabled: false, due: false }, true);
        }
      },
    };

    function useWater() {
      const [state, setState] = React.useState(() => store.state);
      React.useEffect(() => store.subscribe(setState), []);
      return state;
    }

    // ------------------------------------------------------------------
    // Shared inline drop icon (artwork colors allowed to be literal).
    // ------------------------------------------------------------------
    const ICON_DROP = h(
      'svg',
      { viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': true, focusable: false },
      h('path', {
        d: 'M12 2.7C8.6 7.2 5.5 10.9 5.5 14.4a6.5 6.5 0 0 0 13 0c0-3.5-3.1-7.2-6.5-11.7z',
        fill: 'currentColor',
      }),
    );

    // ------------------------------------------------------------------
    // Composer dock widget: today's cups, countdown, quick actions.
    // ------------------------------------------------------------------
    function DockWidget() {
      const t = useT();
      const s = useWater();
      const cups = s.cups[todayKey()] || 0;
      const goal = s.goal;
      const pct = Math.min(100, Math.round((cups / goal) * 100));

      let nextLabel;
      if (!s.enabled) {
        nextLabel = t('dock.paused');
      } else if (s.due) {
        nextLabel = t('dock.due');
      } else {
        const remaining = Math.max(0, s.nextAt - s.now);
        const mm = String(Math.floor(remaining / 60000)).padStart(2, '0');
        const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
        nextLabel = `${t('dock.next')} ${mm}:${ss}`;
      }

      return h(
        'div',
        { className: 'water-dock' },
        h(StyleBlock),
        h('span', { className: 'water-dock-icon', 'aria-hidden': true }, ICON_DROP),
        h('span', { className: 'water-dock-cups' }, `${t('dock.cups')} ${cups}/${goal}`),
        h(
          'span',
          { className: 'water-dock-bar', 'aria-hidden': true },
          h('span', { className: 'water-dock-bar-fill', style: { width: `${pct}%` } }),
        ),
        h('span', { className: `water-dock-next${s.enabled && s.due ? ' water-dock-next-due' : ''}` }, nextLabel),
        h('button', {
          className: 'water-dock-btn',
          type: 'button',
          onClick: () => { requestNotifyPermission(); store.drink(); },
        }, t('dock.drink')),
        h('button', {
          className: 'water-dock-btn',
          type: 'button',
          onClick: () => store.setEnabled(!s.enabled),
        }, s.enabled ? t('dock.pause') : t('dock.resume')),
      );
    }

    // ------------------------------------------------------------------
    // Overlay card: shown frame-wide while a reminder is due.
    // ------------------------------------------------------------------
    function ReminderOverlay() {
      const t = useT();
      const s = useWater();
      if (!s.enabled || !s.due) return null;
      const cups = s.cups[todayKey()] || 0;

      return h(
        'div',
        { className: 'water-overlay', role: 'alert' },
        h(StyleBlock),
        h(
          'div',
          { className: 'water-overlay-card' },
          h(
            'div',
            { className: 'water-overlay-head' },
            h('span', { className: 'water-overlay-drop', 'aria-hidden': true }, ICON_DROP),
            h('strong', { className: 'water-overlay-title' }, t('overlay.title')),
          ),
          h('p', { className: 'water-overlay-body' }, `${t('overlay.body')} ${cups}/${s.goal}`),
          h(
            'div',
            { className: 'water-overlay-actions' },
            h('button', {
              className: 'water-overlay-btn water-overlay-btn-primary',
              type: 'button',
              onClick: () => { requestNotifyPermission(); store.drink(); },
            }, t('overlay.done')),
            h('button', {
              className: 'water-overlay-btn',
              type: 'button',
              onClick: () => store.snooze(5),
            }, t('overlay.snooze')),
            h('button', {
              className: 'water-overlay-btn water-overlay-btn-ghost',
              type: 'button',
              'aria-label': t('overlay.later'),
              title: t('overlay.later'),
              onClick: () => store.snooze(10),
            }, '✕'),
          ),
        ),
      );
    }

    const CSS = `
.water-dock{display:flex;align-items:center;gap:8px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4;max-width:100%;flex-wrap:wrap;}
.water-dock-icon{display:inline-flex;color:var(--dsw-alias-brand-primary);}
.water-dock-cups{color:var(--dsw-alias-label-primary);font-weight:500;white-space:nowrap;}
.water-dock-bar{position:relative;width:64px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;flex:none;}
.water-dock-bar-fill{position:absolute;top:0;bottom:0;left:0;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .3s ease;}
.water-dock-next{white-space:nowrap;font-variant-numeric:tabular-nums;}
.water-dock-next-due{color:var(--dsw-alias-state-warn-primary);font-weight:600;}
.water-dock-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;white-space:nowrap;}
.water-dock-btn:hover{background:var(--dsw-alias-bg-layer-2);}
.water-overlay{position:fixed;right:20px;bottom:20px;z-index:60;}
.water-overlay-card{width:300px;max-width:calc(100vw - 40px);padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 8px 28px rgba(0,0,0,.18);}
@media (prefers-reduced-motion: no-preference){.water-overlay-card{animation:water-overlay-in .25s ease;}}
@keyframes water-overlay-in{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
.water-overlay-head{display:flex;align-items:center;gap:8px;}
.water-overlay-drop{display:inline-flex;color:var(--dsw-alias-brand-primary);}
.water-overlay-title{font-size:14px;font-weight:600;}
.water-overlay-body{margin:8px 0 12px;font-size:12px;color:var(--dsw-alias-label-secondary);}
.water-overlay-actions{display:flex;align-items:center;gap:8px;}
.water-overlay-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap;}
.water-overlay-btn:hover{background:var(--dsw-alias-bg-layer-2);}
.water-overlay-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600;}
.water-overlay-btn-primary:hover{background:var(--dsw-alias-brand-primary);filter:brightness(1.08);}
.water-overlay-btn-ghost{border-color:transparent;padding:6px 8px;color:var(--dsw-alias-label-secondary);}
`;

    // `styles` is a Client builtin, but its availability differs between
    // Harness builds. When it is absent each component renders the same rules
    // as a local <style> element, so the widget never renders unstyled.
    const HAS_STYLE_SERVICE =
      typeof styles !== 'undefined' && !!styles && typeof styles.insert === 'function';

    function StyleBlock() {
      if (HAS_STYLE_SERVICE) return null;
      return h('style', null, CSS);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // Route visible UI text through the Client locale service; keep the
        // built-in dictionary only as a fallback if the service is absent.
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : null;
        if (locale && typeof locale.register === 'function') {
          localeSvc = locale;
          ctx.effect(() => locale.register('water-reminder', 'en', DICTS.en));
          ctx.effect(() => locale.register('water-reminder', 'zh', DICTS.zh));
        }

        if (HAS_STYLE_SERVICE) {
          ctx.effect(() => styles.insert(CSS), 'water-reminder.styles');
        }

        ctx.effect(() => {
          const timer = typeof ctx.get === 'function' ? ctx.get('timer') : null;
          if (timer && typeof timer.interval === 'function') {
            const stop = timer.interval(() => store.tick(), 1000);
            return () => { stop(); };
          }
          const id = window.setInterval(() => store.tick(), 1000);
          return () => window.clearInterval(id);
        }, 'water-reminder.tick');

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'water-reminder',
          order: 5,
          label: 'water-reminder',
        }, DockWidget));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'water-reminder-overlay',
          order: 900,
          label: 'water-reminder',
        }, ReminderOverlay));
      },
    };
  },
});
