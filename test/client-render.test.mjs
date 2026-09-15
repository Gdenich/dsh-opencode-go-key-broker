/**
 * Рендер-тест клиентской половины без браузера.
 *
 * Покрывает то, что уже один раз ломало интерфейс:
 *   1) регистрация секции Settings и бейджа квот в доке композера;
 *   2) `ctx` долетает до компонента, и «Добавить ключ» реально пишет
 *      OPENCODE_GO_KEY_<name> (ошибка «ctx is not defined»);
 *   3) бейдж рисует квоты активного ключа и раскрывает панель со шкалами.
 */
import { readFileSync } from 'node:fs'

// --- минимальный React: состояние хуков на компонент, между проходами ---
const hookStore = new Map()
let hookIndex = 0
let currentComponent = null
class Component {
  constructor(props) {
    this.props = props ?? {}
    this.state = {}
  }
}
const React = {
  Component,
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useRef: (init) => ({ current: init ?? null }),
  useState: (init) => {
    const i = hookIndex++
    if (!hookStore.has(currentComponent)) hookStore.set(currentComponent, [])
    const states = hookStore.get(currentComponent)
    if (!(i in states)) states[i] = typeof init === 'function' ? init() : init
    return [
      states[i],
      (next) => {
        states[i] = typeof next === 'function' ? next(states[i]) : next
      },
    ]
  },
  useEffect: (fn) => {
    try {
      fn()
    } catch {
      /* эффект в тесте не должен ронять проход */
    }
  },
}

const SNAPSHOT_FIXTURE = {
  updatedAt: Date.now(),
  state: 'ok',
  error: null,
  active: 'default',
  dryRun: false,
  enabled: true,
  policy: { thresholds: { rolling: 98, weekly: 98, monthly: 98 }, warnPercent: 80, sticky: true },
  keys: [
    {
      name: 'default',
      masked: 'sk-AAAAA…ZZZZZZ',
      active: true,
      level: 'warn',
      error: null,
      windows: {
        rolling: { percent: 2, status: 'ok', resetsAt: new Date(Date.now() + 4 * 3600e3).toISOString() },
        weekly: { percent: 15, status: 'ok', resetsAt: new Date(Date.now() + 5 * 86400e3).toISOString() },
        monthly: { percent: 89, status: 'ok', resetsAt: new Date(Date.now() + 14 * 86400e3).toISOString() },
      },
    },
    {
      name: 'piagent',
      masked: 'sk-BBBBB…YYYYYY',
      active: false,
      level: 'red',
      error: null,
      windows: {
        rolling: { percent: 0, status: 'ok', resetsAt: null },
        weekly: { percent: 0, status: 'ok', resetsAt: null },
        monthly: { percent: 100, status: 'rate-limited', resetsAt: new Date(Date.now() + 3 * 86400e3).toISOString() },
      },
    },
  ],
  log: [],
}

let mod
const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
}
const fakeWindow = {
  addEventListener: () => {},
  __ModuleLoader__: { load: ({ factory }) => (mod = factory(requireStub)) },
  confirm: () => true,
}
let fetchCalls = 0
const fetchStub = (url) => {
  fetchCalls++
  if (process.env.DBG) console.log('DBG fetch:', String(url).slice(0, 60))
  return Promise.resolve({
    ok: true,
    status: 200,
      json: async () => JSON.parse(JSON.stringify(SNAPSHOT_FIXTURE)),
  })
}
const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
new Function('window', 'navigator', 'document', 'fetch', 'setInterval', 'clearInterval', code)(
  fakeWindow,
  { language: 'en-US' },
  {
    // ненулевой ответ на querySelector заставляет injectCss выйти на первой
    // проверке — DOM-заглушке не нужны setAttribute/appendChild
    querySelector: () => ({}),
    createElement: () => ({}),
    head: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  fetchStub,
  () => 0,
  () => {},
)
console.log('модуль загружен:', typeof mod?.apply === 'function' ? 'apply ok' : 'НЕТ apply')

/** Прогон одного рендера с обнулением индекса хуков. */
function renderPass(component, props) {
  hookIndex = 0
  return render({ type: component, props: props ?? {}, children: [] })
}
/** Мини-рендерер: разворачивает компоненты до хостовых узлов. */
function render(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(render)
  const { type, props, children } = node
  if (typeof type === 'function') {
    const outerIndex = hookIndex
    const outerComponent = currentComponent
    hookIndex = 0
    currentComponent = type
    const out = type.prototype instanceof Component ? new type(props).render() : type(props)
    hookIndex = outerIndex
    currentComponent = outerComponent
    return render(out)
  }
  return { type, props, children: (children ?? []).map(render) }
}
/** Поиск узла по предикату props. */
function find(node, predicate) {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate)
      if (hit) return hit
    }
    return null
  }
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const hit = find(child, predicate)
    if (hit) return hit
  }
  return null
}

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : `  actual=${JSON.stringify(actual)}`))
  if (!ok) failures++
}
const tick = () => new Promise((r) => setTimeout(r, 20))

// --- стенд клиента ---
const apiCalls = []
const fakeCredentials = {
  set: async (ref, value) => {
    apiCalls.push(['set', ref, value])
    return { ok: true }
  },
  unset: async (ref) => {
    apiCalls.push(['unset', ref])
    return { ok: true }
  },
}
const registrations = {}
const ctx = {
  get: (name) =>
    name === 'slots'
      ? {
          inject: (slot, cb) => cb(),
          register: (options, component) => {
            registrations[options.name] = { options, component }
            return () => {}
          },
        }
      : undefined,
  remote: { credentials: fakeCredentials },
}
mod.apply(ctx)

console.log('1) регистрации')
check('секция Settings', registrations['settings.section']?.options?.id, 'opencode-go-keys')
check('бейдж в строке ввода', registrations['conversation.input.right']?.options?.id, 'opencode-go-quota')
check('объявлен сервис slots', mod.inject?.includes('slots'), true)
check('объявлен сервис remote', mod.inject?.includes('remote'), true)
check('объявлен сервис remote.credentials', mod.inject?.includes('remote.credentials'), true)

console.log('2) секция Settings рендерится и пишет ключ')
try {
  let sectionTree = renderPass(registrations['settings.section'].component, { ctx })
  const text = JSON.stringify(sectionTree)
  check('заголовок на месте', /OpenCode Go keys/.test(text), true)
  const nameInput = find(sectionTree, (n) => n.type === 'input' && /name/.test(n.props.placeholder || ''))
  const valueInput = find(sectionTree, (n) => n.type === 'input' && n.props.type === 'password')
  nameInput.props.onChange({ target: { value: 'go2' } })
  valueInput.props.onChange({ target: { value: 'sk-GO2' } })
  sectionTree = renderPass(registrations['settings.section'].component, { ctx })
  const addButton = find(sectionTree, (n) => n.type === 'button' && /Add/.test(JSON.stringify(n.children)))
  addButton.props.onClick()
  await tick()
  check('set вызван с нужным ref', apiCalls[0], ['set', 'OPENCODE_GO_KEY_go2', 'sk-GO2'])
} catch (e) {
  console.log('  FAIL секция: ' + e.message)
  failures++
}

console.log('3) бейдж квот: подписи окон и проценты активного ключа')
try {
  renderPass(registrations['conversation.input.right'].component, {})
  await tick()
  const badge = renderPass(registrations['conversation.input.right'].component, {})
  const text = JSON.stringify(badge)
  if (process.env.DBG) {
    console.log('DBG fetchCalls:', fetchCalls)
    console.log('DBG frames:', [...hookStore.entries()].map(([k, v]) => (k && k.name) + '=' + JSON.stringify(v).slice(0, 80)))
  }
  check('подписи окон 5h/wk/mo', /5h/.test(text) && /wk/.test(text) && /mo/.test(text), true)
  check('проценты окон', /89%/.test(text), true)
  check('панель закрыта', /ogkg-panel/.test(text), false)
} catch (e) {
  console.log('  FAIL бейдж: ' + e.message)
  failures++
}

console.log('4) клик по бейджу раскрывает панель со шкалами')
try {
  let badge = renderPass(registrations['conversation.input.right'].component, {})
  const pill = find(badge, (n) => n.props.className === 'ogkg-pill')
  pill.props.onClick()
  badge = renderPass(registrations['conversation.input.right'].component, {})
  const text = JSON.stringify(badge)
  check('панель открыта', /ogkg-panel/.test(text), true)
  check('оба ключа в панели', /default/.test(text) && /piagent/.test(text), true)
  check('подписи окон в панели', /Month/.test(text), true)
  check('серверный статус виден', /rate-limited/.test(text), true)
  check('шкала нарисована', /ogkb-bar/.test(text), true)
} catch (e) {
  console.log('  FAIL панель: ' + e.message)
  failures++
}

console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРОШЛИ' : `\nПРОВАЛЕНО: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
