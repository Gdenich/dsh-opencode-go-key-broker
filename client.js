/**
 * dsh-opencode-go-key-broker — Client half (Settings → OpenCode Go Keys)
 * ---------------------------------------------------------------------------
 * Браузерный бандл: секция в диалоге Settings.
 *   ctx.slots.register({ name: 'settings.section', id, order, label }, Section)
 *
 * Данные: GET  /plugins/dsh-opencode-go-key-broker/snapshot   (пул, квоты, лог)
 *         POST /plugins/dsh-opencode-go-key-broker/activate   { name }  — форс активного
 *         POST /plugins/dsh-opencode-go-key-broker/refresh            — опросить сейчас
 * Ключи наружу не уходят: в snapshot только имена, маски и проценты.
 * Добавление/удаление ключа идёт через штатный remote-API credentials
 * (тот же лок, что у страницы Models).
 */
window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-key-broker',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const SNAPSHOT = '/plugins/dsh-opencode-go-key-broker/snapshot'
    const ACTIVATE = '/plugins/dsh-opencode-go-key-broker/activate'
    const REFRESH = '/plugins/dsh-opencode-go-key-broker/refresh'
    const DIAG = '/plugins/dsh-opencode-go-key-broker/diag'
    const CSS_ID = 'dsh-opencode-go-key-broker'

    /**
     * Диагностика клиентской половины: ошибки и вехи уходят на хост-роут,
     * который пишет их в файл. Нужна потому, что консоль браузера из плагина
     * не видна, а «пустая вкладка» не отличает «компонент не вызван» от
     * «компонент упал».
     */
    function report(kind, detail) {
      try {
        fetch(DIAG, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            detail: detail === undefined ? null : String(detail).slice(0, 4000),
            at: Date.now(),
            href: typeof location !== 'undefined' ? location.href.replace(/token=[^&]*/, 'token=***') : null,
          }),
        }).catch(() => {})
      } catch {
        /* диагностика не должна ломать плагин */
      }
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('error', (event) => {
        report('window-error', (event && event.message) + ' :: ' + String((event && event.error && event.error.stack) || ''))
      })
      window.addEventListener('unhandledrejection', (event) => {
        report('unhandled-rejection', String((event && event.reason && event.reason.stack) || (event && event.reason)))
      })
    }
    report('module-load', typeof navigator !== 'undefined' ? navigator.userAgent : null)

    const ru = {
      nav: 'OpenCode Go Keys',
      title: 'Ключи OpenCode Go',
      intro:
        'Пул ключей с автоматическим переключением по квотам. Активный ключ подставляется в маршрут opencode-go со следующего запроса; при ошибке квоты брокер переключает ключ и повторяет запрос в том же ходу.',
      active: 'Активный',
      none: 'не задан',
      state: 'Состояние',
      updated: 'Обновлено',
      policy: 'Политика',
      dryRun: 'DRY-RUN (только логи)',
      live: 'включено',
      disabled: 'выключено',
      refresh: 'Обновить',
      addTitle: 'Добавить ключ',
      namePlaceholder: 'имя (например go2)',
      keyPlaceholder: 'sk-…',
      add: 'Добавить',
      remove: 'Удалить',
      makeActive: 'Сделать активным',
      noKeys: 'Пул пуст. Добавь ключи — они лягут в .credentials.yaml как OPENCODE_GO_KEY_<имя>.',
      rolling: 'rolling',
      weekly: 'weekly',
      monthly: 'monthly',
      reset: 'сброс',
      levelOk: 'ок',
      levelWarn: 'близко',
      levelRed: 'лимит',
      levelUnknown: 'нет данных',
      log: 'Журнал решений',
      noLog: 'пока пусто',
      thresholds: 'порог',
      yes: 'да',
      no: 'нет',
      sticky: 'sticky',
      errName: 'Укажи имя ключа (латиница, цифры, _)',
      errValue: 'Укажи значение ключа',
      errApi: 'Нет доступа к credentials API (контекст плагина не передан)',
      saved: 'Готово',
      confirmRemove: 'Удалить ключ',
      quotaTitle: 'OpenCode Go · квоты',
      quotaHint: 'Квоты ключей OpenCode Go — нажмите для деталей',
      winRolling: '5 часов',
      winWeekly: 'Неделя',
      winMonthly: 'Месяц',
      winShort5h: '5ч',
      winShortWk: 'нед',
      winShortMo: 'мес',
      poolEmptyShort: 'пул пуст',
      updatedShort: 'обновлено',
      keysShort: 'ключей',
    }
    const en = {
      nav: 'OpenCode Go Keys',
      title: 'OpenCode Go keys',
      intro:
        'Key pool with automatic quota-driven switching. The active key is picked up by the opencode-go route on the next request; on a quota error the broker switches and retries within the same turn.',
      active: 'Active',
      none: 'unset',
      state: 'State',
      updated: 'Updated',
      policy: 'Policy',
      dryRun: 'DRY-RUN (log only)',
      live: 'enabled',
      disabled: 'disabled',
      refresh: 'Refresh',
      addTitle: 'Add a key',
      namePlaceholder: 'name (e.g. go2)',
      keyPlaceholder: 'sk-…',
      add: 'Add',
      remove: 'Remove',
      makeActive: 'Make active',
      noKeys: 'Pool is empty. Add keys — they are stored as OPENCODE_GO_KEY_<name> in .credentials.yaml.',
      rolling: 'rolling',
      weekly: 'weekly',
      monthly: 'monthly',
      reset: 'resets',
      levelOk: 'ok',
      levelWarn: 'close',
      levelRed: 'limit',
      levelUnknown: 'no data',
      log: 'Decision log',
      noLog: 'nothing yet',
      thresholds: 'threshold',
      yes: 'yes',
      no: 'no',
      sticky: 'sticky',
      errName: 'Key name must be latin letters, digits or _',
      errValue: 'Enter the key value',
      errApi: 'No access to the credentials API (plugin context not passed)',
      saved: 'Done',
      confirmRemove: 'Remove key',
      quotaTitle: 'OpenCode Go · quotas',
      quotaHint: 'OpenCode Go key quotas — click for details',
      winRolling: '5-hour',
      winWeekly: 'Week',
      winMonthly: 'Month',
      winShort5h: '5h',
      winShortWk: 'wk',
      winShortMo: 'mo',
      poolEmptyShort: 'pool empty',
      updatedShort: 'updated',
      keysShort: 'keys',
    }
    const t = /^ru/i.test(typeof navigator !== 'undefined' ? navigator.language || '' : '') ? ru : en

    const CSS = `
.ogkb-root{display:flex;flex-direction:column;gap:16px;font-size:13px}
.ogkb-card{border:1px solid var(--dsw-alias-border-default,rgba(0,0,0,.12));border-radius:10px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1,transparent)}
.ogkb-h{font-size:15px;font-weight:600;margin:0 0 6px}
.ogkb-sub{opacity:.72;line-height:1.5;margin:0}
.ogkb-row{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}
.ogkb-kv{display:flex;gap:6px;align-items:baseline}
.ogkb-kv b{font-weight:600}
.ogkb-badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;border:1px solid transparent}
.ogkb-ok{background:rgba(34,197,94,.14);color:#15803d;border-color:rgba(34,197,94,.35)}
.ogkb-warn{background:rgba(234,179,8,.16);color:#a16207;border-color:rgba(234,179,8,.4)}
.ogkb-red{background:rgba(239,68,68,.15);color:#b91c1c;border-color:rgba(239,68,68,.4)}
.ogkb-unknown{background:rgba(120,120,120,.14);color:#525252;border-color:rgba(120,120,120,.3)}
.ogkb-muted{opacity:.6}
.ogkb-table{width:100%;border-collapse:collapse}
.ogkb-table th,.ogkb-table td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.08));vertical-align:middle}
.ogkb-table th{font-weight:600;opacity:.7;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.ogkb-bar{position:relative;height:6px;border-radius:3px;background:rgba(120,120,120,.22);min-width:64px;overflow:hidden}
.ogkb-bar span{position:absolute;inset:0 auto 0 0;border-radius:3px}
.ogkb-cell{display:flex;flex-direction:column;gap:3px;min-width:92px}
.ogkb-btn{font:inherit;padding:4px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-default,rgba(0,0,0,.18));background:transparent;cursor:pointer}
.ogkb-btn:hover{background:rgba(120,120,120,.1)}
.ogkb-btn[disabled]{opacity:.45;cursor:default}
.ogkb-btn-primary{border-color:transparent;background:var(--dsw-alias-bg-accent,#2563eb);color:#fff}
.ogkb-input{font:inherit;padding:5px 2px;border:none;border-bottom:1px solid var(--dsw-alias-border-default,rgba(0,0,0,.2));background:transparent;color:inherit;min-width:150px}
.ogkb-input:focus{outline:none;border-bottom-color:var(--dsw-alias-bg-accent,#2563eb)}
.ogkb-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ogkb-log{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.6;max-height:190px;overflow:auto;opacity:.85}
.ogkb-err{color:#b91c1c}
.ogkb-tag{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;opacity:.75}
/* --- бейдж квот в строке композера --- */
.ogkg-root{position:relative;display:inline-flex;align-items:center}
.ogkg-pill{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11px;line-height:1;padding:4px 6px;border-radius:8px;border:none;background:transparent;color:inherit;cursor:pointer;white-space:nowrap;opacity:.9}
.ogkg-pill:hover{background:rgba(120,120,120,.12);opacity:1}
.ogkg-part{display:inline-flex;align-items:baseline;gap:3px}
.ogkg-part-label{opacity:.5}
.ogkg-part-val{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ogkg-sep{opacity:.35}
.ogkg-chev{opacity:.45;margin-left:1px}
.ogkg-panel{position:absolute;bottom:calc(100% + 8px);right:0;z-index:60;min-width:340px;max-width:420px;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-default,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 10px 30px rgba(0,0,0,.18);color:var(--dsw-alias-text-primary,inherit)}
.ogkg-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.ogkg-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.ogkg-name{font-weight:600}
.ogkg-title{font-size:12px;font-weight:600}
.ogkg-sub{font-size:10px;opacity:.6}
.ogkg-key{padding:8px 0;border-top:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.08))}
.ogkg-key:first-of-type{border-top:none}
.ogkg-keyhead{display:flex;align-items:center;gap:6px;font-size:11px;margin-bottom:5px}
.ogkg-win{display:grid;grid-template-columns:74px 42px 1fr 96px;align-items:center;gap:8px;font-size:10px;padding:2px 0}
.ogkg-win-label{opacity:.7}
.ogkg-win-pct{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right}
.ogkg-win-eta{display:flex;align-items:center;justify-content:flex-end;gap:5px}
.ogkg-eta-text{opacity:.55;white-space:nowrap}
.ogkg-badge-mini{font-size:9px;padding:0 5px;line-height:14px;border-radius:6px}
.ogkg-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.08));font-size:10px;opacity:.75}
.ogkg-empty{font-size:11px;opacity:.7;padding:6px 0}
`

    function injectCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') !== null) return
      const el = document.createElement('style')
      el.setAttribute('data-plugin-css', CSS_ID)
      el.textContent = CSS
      document.head.appendChild(el)
    }

    const barColor = (level) =>
      level === 'red' ? '#ef4444' : level === 'warn' ? '#eab308' : level === 'unknown' ? '#9ca3af' : '#22c55e'

    function bar(percent, level) {
      const p = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 0
      return h(
        'div',
        { className: 'ogkb-bar' },
        h('span', { style: { width: p + '%', background: barColor(level) } }),
      )
    }

    function until(iso) {
      if (typeof iso !== 'string') return ''
      const ms = Date.parse(iso) - Date.now()
      if (!Number.isFinite(ms)) return ''
      if (ms <= 0) return '0м'
      const min = Math.round(ms / 60000)
      const d = Math.floor(min / 1440)
      const hours = Math.floor((min % 1440) / 60)
      if (d > 0) return d + 'д ' + hours + 'ч'
      if (hours > 0) return hours + 'ч ' + (min % 60) + 'м'
      return min + 'м'
    }

    function badge(level) {
      const label =
        level === 'red' ? t.levelRed : level === 'warn' ? t.levelWarn : level === 'unknown' ? t.levelUnknown : t.levelOk
      return h('span', { className: 'ogkb-badge ogkb-' + level }, label)
    }

    function windowCell(w, level) {
      const percent = w && typeof w.percent === 'number' ? w.percent : null
      return h(
        'div',
        { className: 'ogkb-cell' },
        h(
          'div',
          { className: 'ogkb-row', style: { gap: '6px' } },
          h('span', { className: 'ogkb-tag' }, percent === null ? '—' : percent + '%'),
          w && w.status && w.status !== 'ok' ? h('span', { className: 'ogkb-badge ogkb-red' }, w.status) : null,
        ),
        bar(percent, level),
        h('span', { className: 'ogkb-muted', style: { fontSize: '11px' } }, until(w && w.resetsAt)),
      )
    }

    /**
     * Клиентский ctx приходит в компонент пропсом от обёртки, которую
     * регистрирует `apply`: сам `Section` до `ctx` из `apply` не дотягивается
     * (это была ошибка «ctx is not defined»).
     */
    function credentialsApi(props) {
      const remote = props && props.ctx && props.ctx.remote
      return remote && remote.credentials ? remote.credentials : null
    }

    function Section(props) {
      const [snap, setSnap] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [name, setName] = React.useState('')
      const [value, setValue] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)

      async function load(force) {
        try {
          const res = await fetch(SNAPSHOT + (force ? '?force=1' : ''), { headers: { Accept: 'application/json' } })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          setSnap(await res.json())
          setError(null)
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }

      React.useEffect(() => {
        report('section-mounted', null)
        injectCss()
        load(false)
        const id = setInterval(() => load(false), 30000)
        return () => clearInterval(id)
      }, [])

      async function mutate(fn) {
        setBusy(true)
        setNotice(null)
        try {
          await fn()
          await load(true)
        } catch (e) {
          setNotice(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      function addKey() {
        const trimmed = name.trim()
        if (!/^[A-Za-z0-9_]+$/.test(trimmed)) return setNotice(t.errName)
        if (value.trim().length === 0) return setNotice(t.errValue)
        if (trimmed === 'ACTIVE') return setNotice(t.errName)
        mutate(async () => {
          const api = credentialsApi(props)
          if (api === null) throw new Error(t.errApi)
          const res = await api.set('OPENCODE_GO_KEY_' + trimmed, value.trim())
          if (!res.ok) throw new Error(res.error.message)
          setName('')
          setValue('')
          setNotice(t.saved)
        })
      }

      function removeKey(keyName) {
        if (typeof window !== 'undefined' && !window.confirm(t.confirmRemove + ' ' + keyName + '?')) return
        mutate(async () => {
          const api = credentialsApi(props)
          if (api === null) throw new Error(t.errApi)
          const res = await api.unset('OPENCODE_GO_KEY_' + keyName)
          if (!res.ok) throw new Error(res.error.message)
        })
      }

      function activate(keyName) {
        mutate(async () => {
          const res = await fetch(ACTIVATE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: keyName }),
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          setSnap(await res.json())
        })
      }

      const keys = (snap && snap.keys) || []
      const policy = (snap && snap.policy) || {}
      const stateLabel = snap
        ? snap.dryRun
          ? t.dryRun
          : snap.enabled === false
            ? t.disabled
            : snap.state === 'no-pool'
              ? t.noKeys.split('.')[0]
              : snap.state
        : '…'

      return h(
        'div',
        { className: 'ogkb-root' },
        h(
          'div',
          { className: 'ogkb-card' },
          h('h2', { className: 'ogkb-h' }, t.title),
          h('p', { className: 'ogkb-sub' }, t.intro),
        ),
        h(
          'div',
          { className: 'ogkb-card' },
          h(
            'div',
            { className: 'ogkb-row' },
            h('div', { className: 'ogkb-kv' }, h('span', { className: 'ogkb-muted' }, t.active + ':'), h('b', {}, snap && snap.active ? snap.active : t.none)),
            h('div', { className: 'ogkb-kv' }, h('span', { className: 'ogkb-muted' }, t.state + ':'), h('span', { className: 'ogkb-tag' }, String(stateLabel))),
            h(
              'div',
              { className: 'ogkb-kv' },
              h('span', { className: 'ogkb-muted' }, t.updated + ':'),
              h('span', { className: 'ogkb-tag' }, snap && snap.updatedAt ? new Date(snap.updatedAt).toLocaleTimeString() : '—'),
            ),
            h(
              'div',
              { className: 'ogkb-kv' },
              h('span', { className: 'ogkb-muted' }, t.thresholds + ':'),
              h('span', { className: 'ogkb-tag' }, `r${policy.thresholds ? policy.thresholds.rolling : '—'}/w${policy.thresholds ? policy.thresholds.weekly : '—'}/m${policy.thresholds ? policy.thresholds.monthly : '—'}`),
            ),
            h('div', { className: 'ogkb-kv' }, h('span', { className: 'ogkb-muted' }, t.sticky + ':'), h('span', { className: 'ogkb-tag' }, policy.sticky ? t.yes : t.no)),
            h('button', { className: 'ogkb-btn', disabled: busy, onClick: () => mutate(() => load(true)) }, t.refresh),
          ),
          snap && snap.error ? h('p', { className: 'ogkb-err' }, snap.error) : null,
          error ? h('p', { className: 'ogkb-err' }, error) : null,
          notice ? h('p', { className: 'ogkb-muted' }, notice) : null,
        ),
        h(
          'div',
          { className: 'ogkb-card' },
          keys.length === 0
            ? h('p', { className: 'ogkb-sub' }, t.noKeys)
            : h(
                'table',
                { className: 'ogkb-table' },
                h(
                  'thead',
                  {},
                  h(
                    'tr',
                    {},
                    h('th', {}, 'key'),
                    h('th', {}, t.rolling),
                    h('th', {}, t.weekly),
                    h('th', {}, t.monthly),
                    h('th', {}, ''),
                  ),
                ),
                h(
                  'tbody',
                  {},
                  keys.map((k) =>
                    h(
                      'tr',
                      { key: k.name },
                      h(
                        'td',
                        {},
                        h(
                          'div',
                          { className: 'ogkb-row', style: { gap: '8px' } },
                          k.active ? h('span', { title: t.active }, '★') : h('span', { className: 'ogkb-muted' }, '·'),
                          h('b', {}, k.name),
                          badge(k.level),
                        ),
                        h('div', { className: 'ogkb-tag' }, k.masked + (k.error ? ' · ' + k.error : '')),
                      ),
                      h('td', {}, windowCell(k.windows && k.windows.rolling, k.level)),
                      h('td', {}, windowCell(k.windows && k.windows.weekly, k.level)),
                      h('td', {}, windowCell(k.windows && k.windows.monthly, k.level)),
                      h(
                        'td',
                        {},
                        h(
                          'div',
                          { className: 'ogkb-actions' },
                          h(
                            'button',
                            { className: 'ogkb-btn', disabled: busy || k.active, onClick: () => activate(k.name) },
                            t.makeActive,
                          ),
                          h('button', { className: 'ogkb-btn', disabled: busy, onClick: () => removeKey(k.name) }, t.remove),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
        ),
        h(
          'div',
          { className: 'ogkb-card' },
          h('h3', { className: 'ogkb-h' }, t.addTitle),
          h(
            'div',
            { className: 'ogkb-actions' },
            h('input', {
              className: 'ogkb-input',
              placeholder: t.namePlaceholder,
              value: name,
              onChange: (e) => setName(e.target.value),
            }),
            h('input', {
              className: 'ogkb-input',
              placeholder: t.keyPlaceholder,
              type: 'password',
              value: value,
              onChange: (e) => setValue(e.target.value),
            }),
            h('button', { className: 'ogkb-btn ogkb-btn-primary', disabled: busy, onClick: addKey }, t.add),
          ),
        ),
        h(
          'div',
          { className: 'ogkb-card' },
          h('h3', { className: 'ogkb-h' }, t.log),
          h(
            'div',
            { className: 'ogkb-log' },
            (snap && snap.log && snap.log.length > 0
              ? snap.log
              : [{ at: Date.now(), action: t.noLog }]
            ).map((entry, i) =>
              h(
                'div',
                { key: String(entry.at) + '-' + i },
                new Date(entry.at).toLocaleTimeString() +
                  '  ' +
                  entry.action +
                  (entry.to ? ' → ' + entry.to : '') +
                  (entry.reason ? '  (' + entry.reason + ')' : '') +
                  (entry.masked ? '  ' + entry.masked : ''),
              ),
            ),
          ),
        ),
      )
    }

    /**
     * Уровень одного окна квоты (клиентская копия правил хоста — нужна только
     * для раскраски шкал): красный — серверный статус или percent ≥ порога,
     * «близко» — percent ≥ warnPercent, иначе ок.
     */
    function windowLevel(win, windowKey, policy) {
      if (!win) return 'unknown'
      if (win.status !== null && win.status !== undefined && win.status !== 'ok') return 'red'
      if (typeof win.percent !== 'number') return 'unknown'
      const limit = (policy && policy.thresholds && policy.thresholds[windowKey]) ?? 98
      if (win.percent >= limit) return 'red'
      if (win.percent >= ((policy && policy.warnPercent) ?? 80)) return 'warn'
      return 'ok'
    }

    const LEVEL_COLOR = { ok: '#22c55e', warn: '#eab308', red: '#ef4444', unknown: '#9ca3af' }
    const WORST = { unknown: 0, ok: 1, warn: 2, red: 3 }
    const worstLevel = (levels) => levels.reduce((acc, l) => (WORST[l] > WORST[acc] ? l : acc), 'ok')


    function quotaBar(percent, color) {
      const p = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 0
      return h('div', { className: 'ogkb-bar' }, h('span', { style: { width: p + '%', background: color } }))
    }

    /**
     * Иконка OpenCode Go для бейджа: скруглённый квадрат с «GO», залитый
     * цветом худшего окна активного ключа (иконка заодно работает индикатором).
     * Готового набора иконок провайдеров в бандле приложения нет.
     */
    function goIcon(color) {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { flex: '0 0 auto' } },
        h('rect', { x: 0.5, y: 0.5, width: 15, height: 15, rx: 4, fill: color }),
        h(
          'text',
          {
            x: 8,
            y: 11.5,
            textAnchor: 'middle',
            fontSize: 8,
            fontWeight: 700,
            fill: '#fff',
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          },
          'GO',
        ),
      )
    }

    function quotaWindowRow(win, windowKey, label, policy) {
      const level = windowLevel(win, windowKey, policy)
      const percent = win && typeof win.percent === 'number' ? win.percent : null
      const status = win && win.status && win.status !== 'ok' ? win.status : null
      return h(
        'div',
        { className: 'ogkg-win', key: windowKey },
        h('span', { className: 'ogkg-win-label' }, label),
        h('span', { className: 'ogkg-win-pct' }, percent === null ? '—' : percent + '%'),
        quotaBar(percent, LEVEL_COLOR[level]),
        h(
          'span',
          { className: 'ogkg-win-eta' },
          h('span', { className: 'ogkg-eta-text' }, win && win.resetsAt ? until(win.resetsAt) : ''),
          status ? h('span', { className: 'ogkb-badge ogkb-red ogkg-badge-mini' }, status) : null,
        ),
      )
    }

    /**
     * Бейдж квот в доке композера (`conversation.composer.dock`): активный ключ
     * и его окна, по клику — панель со шкалами по всему пулу.
     * Данные — тот же snapshot-маршрут хоста, что у вкладки Settings.
     */
    function QuotaBadge() {
      const [snap, setSnap] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const rootRef = React.useRef ? React.useRef(null) : { current: null }

      async function load(force) {
        try {
          const res = await fetch(SNAPSHOT + (force ? '?force=1' : ''), { headers: { Accept: 'application/json' } })
          if (res.ok) setSnap(await res.json())
        } catch {
          /* бейдж не должен ломать композер из-за сети */
        }
      }

      React.useEffect(() => {
        report('badge-mounted', null)
        injectCss()
        load(false)
        const id = setInterval(() => load(false), 30000)
        return () => clearInterval(id)
      }, [])

      React.useEffect(() => {
        if (!open || typeof document === 'undefined') return
        const onDown = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      const policy = (snap && snap.policy) || {}
      const keys = (snap && snap.keys) || []
      const active = keys.find((k) => k.active) || null
      const activeLevel = active ? active.level : 'unknown'
      const pillTitle = t.quotaHint + (active ? ' — ' + active.name : '')

      // Вид как у бейджа подписок: иконка, компактные окна «5h 3% · wk 70% · mo 85%»
      // (каждый процент окрашен по своему окну) и шеврон раскрытия.
      const pillParts = active
        ? ['rolling', 'weekly', 'monthly'].map((windowKey, index) => {
            const win = (active.windows || {})[windowKey]
            const level = windowLevel(win, windowKey, policy)
            const percent = win && typeof win.percent === 'number' ? win.percent : null
            const label = [t.winShort5h, t.winShortWk, t.winShortMo][index]
            return [
              index > 0 ? h('span', { className: 'ogkg-sep', key: 'sep' + windowKey }, '·') : null,
              h(
                'span',
                { className: 'ogkg-part', key: windowKey },
                h('span', { className: 'ogkg-part-label' }, label),
                h('span', { className: 'ogkg-part-val', style: { color: LEVEL_COLOR[level] } }, percent === null ? '—' : percent + '%'),
              ),
            ]
          })
        : null

      const pill = h(
        'button',
        {
          type: 'button',
          className: 'ogkg-pill',
          title: pillTitle,
          onClick: () => setOpen((was) => !was),
        },
        goIcon(LEVEL_COLOR[activeLevel] || LEVEL_COLOR.unknown),
        snap === null
          ? h('span', { className: 'ogkg-name' }, '…')
          : keys.length === 0
            ? h('span', { className: 'ogkg-name' }, t.poolEmptyShort)
            : pillParts,
        h(
          'svg',
          { className: 'ogkg-chev', width: 12, height: 12, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
          h('path', {
            d: 'M4 6.5l4 4 4-4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ),
      )

      const panel = !open
        ? null
        : h(
            'div',
            { className: 'ogkg-panel', role: 'dialog' },
            h(
              'div',
              { className: 'ogkg-head' },
              h('span', { className: 'ogkg-title' }, t.quotaTitle),
              h(
                'span',
                { className: 'ogkg-sub' },
                t.updatedShort + ' ' + (snap && snap.updatedAt ? new Date(snap.updatedAt).toLocaleTimeString() : '—'),
              ),
            ),
            keys.length === 0
              ? h('div', { className: 'ogkg-empty' }, t.noKeys)
              : keys.map((k) =>
                  h(
                    'div',
                    { className: 'ogkg-key', key: k.name },
                    h(
                      'div',
                      { className: 'ogkg-keyhead' },
                      h('span', { className: 'ogkg-dot', style: { background: LEVEL_COLOR[k.level] } }),
                      h('b', {}, k.name),
                      k.active ? h('span', { title: t.active }, '★') : null,
                      h('span', { className: 'ogkb-badge ogkb-' + k.level + ' ogkg-badge-mini' }, k.level),
                      h('span', { className: 'ogkb-tag' }, k.masked + (k.error ? ' · ' + k.error : '')),
                    ),
                    quotaWindowRow(k.windows && k.windows.rolling, 'rolling', t.winRolling, policy),
                    quotaWindowRow(k.windows && k.windows.weekly, 'weekly', t.winWeekly, policy),
                    quotaWindowRow(k.windows && k.windows.monthly, 'monthly', t.winMonthly, policy),
                  ),
                ),
            h(
              'div',
              { className: 'ogkg-foot' },
              h('span', {}, keys.length + ' ' + t.keysShort + (snap && snap.dryRun ? ' · DRY-RUN' : '')),
              h(
                'button',
                {
                  className: 'ogkb-btn',
                  disabled: busy,
                  onClick: () => {
                    setBusy(true)
                    load(true).finally(() => setBusy(false))
                  },
                },
                t.refresh,
              ),
            ),
          )

      return h('span', { className: 'ogkg-root', ref: rootRef }, pill, panel)
    }

    /**
     * Граница ошибок: вместо пустой вкладки показываем текст сбоя.
     * Нужна и как диагностика, и как страховка — падение рендера одной
     * секции не должно выглядеть как «плагин ничего не нарисовал».
     */
    class SectionBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        report('render-error', (error && error.stack) || error)
        try {
          console.error('dsh-opencode-go-key-broker: render failed', error)
        } catch {
          /* консоль недоступна — не наша забота */
        }
      }
      render() {
        if (this.state.error !== null) {
          const detail = String((this.state.error && this.state.error.stack) || this.state.error)
          return h(
            'div',
            { className: 'ogkb-root' },
            h(
              'div',
              { className: 'ogkb-card' },
              h('h2', { className: 'ogkb-h' }, t.title + ' — ошибка рендера'),
              h('pre', { className: 'ogkb-err', style: { whiteSpace: 'pre-wrap', fontSize: '11px' } }, detail),
            ),
          )
        }
        return h(Section, this.props)
      }
    }

    /**
     * Тихая граница для бейджа в композере: падение виджета квот не должно
     * ломать поле ввода запроса, поэтому при ошибке не рисуем ничего
     * (только репорт в диагностику).
     */
    class QuietBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        report('badge-render-error', (error && error.stack) || error)
      }
      render() {
        if (this.state.error !== null) return null
        return h(QuotaBadge, this.props)
      }
    }

    /**
     * Регистрация: секция в Settings и бейдж квот в доке композера.
     *
     * Форма взята у рабочих сторонних плагинов: только name/id/order(+label)
     * и второй аргумент — функция-обёртка, возвращающая элемент.
     */
    function apply(ctx) {
      try {
        const slots = ctx.get('slots')
        if (slots === undefined) {
          report('apply-error', 'ctx.get("slots") is undefined')
          return
        }
        const dispose = slots.inject('settings.section', () =>
          slots.register(
            {
              name: 'settings.section',
              id: 'opencode-go-keys',
              order: 20,
              label: () => t.nav,
            },
            () => h(SectionBoundary, { ctx }),
          ),
        )
        slots.inject('conversation.input.right', () =>
          slots.register(
            {
              name: 'conversation.input.right',
              id: 'opencode-go-quota',
              order: 5,
            },
            () => h(QuietBoundary, {}),
          ),
        )
        report('apply-ok', 'registered settings.section + conversation.input.right, dispose=' + typeof dispose)
      } catch (error) {
        report('apply-error', (error && error.stack) || error)
        try {
          console.error('dsh-opencode-go-key-broker: apply failed', error)
        } catch {
          /* консоль недоступна */
        }
      }
    }

    exports.apply = apply
    // Клиентский контекст — прокси cordis: любой сервис, к которому плагин
    // обращается, обязан быть объявлен здесь, иначе
    // «cannot get property "remote" without inject».
    exports.inject = ['slots', 'remote', 'remote.credentials']
    return module.exports
  },
})
