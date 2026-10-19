/**
 * Стенд для хост-половины брокера: фейковые credentials/fetch/webServer.
 * Запуск:  node test/host.test.mjs   (из каталога проекта)
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../index.js'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : `  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`))
  if (!ok) failures++
}

const WINDOW = (percent, status = 'ok', resetsAt = '2026-09-20T00:00:00.000Z') => ({ percent, status, resetsAt })
const usageOf = (rolling, weekly, monthly) => ({ rolling: WINDOW(rolling), weekly: WINDOW(weekly), monthly: WINDOW(monthly) })

function makeWorld({ keys, usage, dryRun = false, config = {}, layout = 'nested' }) {
  const store = new Map()
  const hooks = new Map()
  const routes = []
  for (const [name, value] of Object.entries(keys)) store.set(name, value)
  const home = mkdtempSync(join(tmpdir(), 'broker-'))
  // Реальная раскладка dsh-credentials-local: ссылки вложены под `refs:`
  // с двумя пробелами отступа (именно на этом ломался прежний скан).
  // `flat` — дореформенный документ, тоже должен читаться.
  const body = Object.entries(keys)
    .map(([name, value]) => (layout === 'nested' ? `  ${name}: ${value}` : `${name}: ${value}`))
    .join('\n')
  const yaml = layout === 'nested' ? `version: 1\nrefs:\n${body}\nrecords:\n` : `${body}\n`
  writeFileSync(join(home, '.credentials.yaml'), yaml)

  const ctx = {
    credentials: {
      async resolve(ref) {
        const v = store.get(ref)
        return v === undefined ? { configured: false, writable: true } : { configured: true, writable: true, value: v }
      },
      async set(ref, value) {
        store.set(ref, value)
      },
      async unset(ref) {
        store.delete(ref)
      },
    },
    interval() {
      return () => {}
    },
    on(event, fn) {
      hooks.set(event, fn)
      return () => {}
    },
    get(name) {
      return name === 'webServer' ? { register(spec) { routes.push(spec); return () => {} } } : undefined
    },
    effect(fn) {
      return fn()
    },
  }

  const fetchLog = []
  globalThis.fetch = async (url, opts) => {
    const key = String(opts?.headers?.Authorization || '').replace('Bearer ', '')
    fetchLog.push(key)
    const table = usage[key]
    if (table === undefined) return { ok: false, status: 401, async json() { return {} } }
    if (table === 'network') throw new Error('boom')
    return { ok: true, status: 200, async json() { return { usage: table } } }
  }

  plugin.apply(ctx, { dshHome: home, refreshMs: 3_600_000, timeoutMs: 500, dryRun, switchOnError: true, ...config })
  return {
    store,
    hooks,
    routes,
    fetchLog,
    handler: (suffix) => routes.find((r) => r.path.endsWith(suffix)),
    usage,
  }
}

async function http(route, { method = 'GET', body, url = 'http://127.0.0.1:1/plugins/dsh-opencode-go-key-broker/x' } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      headers: { host: '127.0.0.1:1' },
      socket: { remoteAddress: '127.0.0.1' },
      on(event, fn) {
        if (event === 'data' && body !== undefined) fn(Buffer.from(JSON.stringify(body)))
        if (event === 'end') fn()
      },
      destroy() {},
    }
    const res = {
      status: 0,
      payload: undefined,
      writeHead(status) {
        this.status = status
      },
      end(text) {
        try {
          this.payload = text ? JSON.parse(text) : undefined
        } catch {
          this.payload = text
        }
        resolve({ status: this.status, body: this.payload })
      },
    }
    Promise.resolve(route.handler(req, res)).catch(reject)
  })
}

const settle = () => new Promise((r) => setTimeout(r, 80))

// ---------------------------------------------------------------- сценарий 1
console.log('1) активный ключ выгорел по monthly → уходим на следующий зелёный')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
      OPENCODE_GO_KEY_go3: 'sk-GO3',
    },
    usage: { 'sk-GO1': usageOf(10, 20, 99), 'sk-GO2': usageOf(5, 5, 5), 'sk-GO3': usageOf(1, 1, 1) },
  })
  await settle()
  check('активный = go2', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go2')
  check('реф маршрута указывает на go2', w.store.get('OPENCODE_GO_API_KEY'), 'sk-GO2')
  const snap = await http(w.handler('/snapshot'))
  check('в snapshot активный = go2', snap.body.active, 'go2')
  check('go1 помечен red', snap.body.keys.find((k) => k.name === 'go1').level, 'red')
  check('в логе есть switch', snap.body.log.some((l) => l.action === 'switch' && l.to === 'go2'), true)
}

// ---------------------------------------------------------------- сценарий 2
console.log('2) sticky: ключ зелёный → остаёмся, даже если первый освободился')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO2',
      OPENCODE_GO_KEY_ACTIVE: 'go2',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(1, 1, 1), 'sk-GO2': usageOf(30, 30, 40) },
  })
  await settle()
  check('остались на go2', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go2')
  check('реф не тронут', w.store.get('OPENCODE_GO_API_KEY'), 'sk-GO2')
}

// ---------------------------------------------------------------- сценарий 3
console.log('3) все красные → никого не выбираем, состояние all-red')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(99, 99, 99), 'sk-GO2': usageOf(98, 99, 99) },
  })
  await settle()
  check('активным остался go1', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go1')
  const snap = await http(w.handler('/snapshot'))
  check('состояние all-red', snap.body.state, 'all-red')
}

// ---------------------------------------------------------------- сценарий 4
console.log('4) реактивная ветка: QUOTA → {kind:retry} и переключение')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(10, 10, 10), 'sk-GO2': usageOf(5, 5, 5) },
  })
  await settle()
  check('до ошибки активный = go1', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go1')
  // сервер объявил квоту исчерпанной, локальный опрос ещё не знает
  w.usage['sk-GO1'] = { rolling: { percent: 100, status: 'rate-limited' }, weekly: WINDOW(10), monthly: WINDOW(10) }
  const retry = await w.hooks.get('agent/request-error')({ failure: { code: 'QUOTA' } }, async () => undefined)
  check('вернули retry', retry, { kind: 'retry' })
  check('переключились на go2', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go2')
}

// ---------------------------------------------------------------- сценарий 5
console.log('5) dryRun: решения только в лог, записи нет')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(10, 20, 99), 'sk-GO2': usageOf(1, 1, 1) },
    dryRun: true,
  })
  await settle()
  check('реф не изменён', w.store.get('OPENCODE_GO_API_KEY'), 'sk-GO1')
  const snap = await http(w.handler('/snapshot'))
  check('в логе would-switch', snap.body.log.some((l) => l.action === 'would-switch'), true)
}

// ---------------------------------------------------------------- сценарий 6
console.log('6) prefer=headroom: берём ключ с наибольшим запасом')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
      OPENCODE_GO_KEY_go3: 'sk-GO3',
    },
    usage: { 'sk-GO1': usageOf(99, 10, 10), 'sk-GO2': usageOf(50, 50, 50), 'sk-GO3': usageOf(10, 10, 10) },
    config: { prefer: 'headroom' },
  })
  await settle()
  check('выбрали go3 (больше запаса)', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go3')
}

// ---------------------------------------------------------------- сценарий 7
console.log('7) 401 (невалидный ключ) = красный; сетевой сбой = не красный')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-BAD',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
      OPENCODE_GO_KEY_go3: 'sk-GO3',
    },
    usage: { 'sk-BAD': undefined, 'sk-GO2': 'network', 'sk-GO3': usageOf(10, 10, 10) },
  })
  await settle()
  check('ушли с невалидного на go3', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go3')
}

// ---------------------------------------------------------------- сценарий 8
console.log('8) ручной форс активного через маршрут /activate')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(5, 5, 5), 'sk-GO2': usageOf(7, 7, 7) },
  })
  await settle()
  const res = await http(w.handler('/activate'), { method: 'POST', body: { name: 'go2' } })
  check('HTTP 200', res.status, 200)
  check('активный = go2', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go2')
  check('реф маршрута = ключ go2', w.store.get('OPENCODE_GO_API_KEY'), 'sk-GO2')
}

// ---------------------------------------------------------------- сценарий 9
console.log('9) чужой origin / не-loopback → 403 на мутацию')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(5, 5, 5), 'sk-GO2': usageOf(5, 5, 5) },
  })
  await settle()
  const route = w.handler('/activate')
  const res = await new Promise((resolve) => {
    const req = {
      method: 'POST',
      url: '/plugins/dsh-opencode-go-key-broker/activate',
      headers: { host: '127.0.0.1:1', origin: 'http://evil.example' },
      socket: { remoteAddress: '127.0.0.1' },
      on() {},
      destroy() {},
    }
    const res2 = {
      writeHead(s) {
        this.status = s
      },
      end(t) {
        resolve({ status: this.status, body: t })
      },
    }
    route.handler(req, res2)
  })
  check('HTTP 403', res.status, 403)
  check('ключ не сменился', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go1')
}

// ---------------------------------------------------------------- сценарий 10
console.log('10) дореформенная плоская раскладка файла тоже читается')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(10, 20, 99), 'sk-GO2': usageOf(1, 1, 1) },
    layout: 'flat',
  })
  await settle()
  check('пул найден и переключение сработало', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go2')
}

// ---------------------------------------------------------------- сценарий 11
console.log('11) 97% при пороге 98% — ещё НЕ красный, ключ не трогаем')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(50, 50, 97), 'sk-GO2': usageOf(1, 1, 1) },
  })
  await settle()
  check('остались на go1', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go1')
  const snap = await http(w.handler('/snapshot'))
  check('go1 не красный', snap.body.keys.find((k) => k.name === 'go1').level, 'warn')
}

// ---------------------------------------------------------------- сценарий 12
console.log('12) активный красный, кандидат «близко» (не красный) — переключаемся')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(10, 10, 98), 'sk-GO2': usageOf(10, 10, 90) },
  })
  await settle()
  check('ушли на go2 (он не красный)', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go2')
}

// ---------------------------------------------------------------- сценарий 13
console.log('13) активный красный, все остальные красные/неизвестные — не переключаемся')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO1',
      OPENCODE_GO_KEY_ACTIVE: 'go1',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
      OPENCODE_GO_KEY_go3: 'sk-GO3',
    },
    usage: { 'sk-GO1': usageOf(10, 10, 98), 'sk-GO2': usageOf(10, 10, 99), 'sk-GO3': 'network' },
  })
  await settle()
  check('остались на go1', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go1')
  const snap = await http(w.handler('/snapshot'))
  check('в журнале нет switch', snap.body.log.some((l) => l.action === 'switch'), false)
}

// ---------------------------------------------------------------- сценарий 14
console.log('14) боевой режим: пометка активного выравнивается, сам ключ не трогается')
{
  const w = makeWorld({
    keys: {
      OPENCODE_GO_API_KEY: 'sk-GO2',
      OPENCODE_GO_KEY_go1: 'sk-GO1',
      OPENCODE_GO_KEY_go2: 'sk-GO2',
    },
    usage: { 'sk-GO1': usageOf(5, 5, 5), 'sk-GO2': usageOf(10, 10, 10) },
  })
  await settle()
  check('пометка выставлена по значению', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go2')
  check('ключ маршрута не изменён', w.store.get('OPENCODE_GO_API_KEY'), 'sk-GO2')
  const snap = await http(w.handler('/snapshot'))
  check('в журнале marker-sync', snap.body.log.some((l) => l.action === 'marker-sync'), true)
}

console.log('15) перевыпуск активного ключа под тем же именем обновляет реф маршрута')
{
  const w = makeWorld({
    keys: { OPENCODE_GO_API_KEY: 'sk-old', OPENCODE_GO_KEY_ACTIVE: 'go1', OPENCODE_GO_KEY_go1: 'oc_sk_new' },
    usage: { oc_sk_new: usageOf(3, 6, 3) },
  })
  await settle()
  check('маршрут получил новый ключ', w.store.get('OPENCODE_GO_API_KEY'), 'oc_sk_new')
  check('имя активного осталось прежним', w.store.get('OPENCODE_GO_KEY_ACTIVE'), 'go1')
  // Повторная замена уже во время работы хоста.
  w.store.set('OPENCODE_GO_KEY_go1', 'oc_sk_newer')
  w.usage.oc_sk_newer = usageOf(4, 7, 4)
  await http(w.handler('/snapshot'), { url: 'http://127.0.0.1:1/plugins/dsh-opencode-go-key-broker/snapshot?force=1' })
  check('следующий refresh подхватил перевыпуск', w.store.get('OPENCODE_GO_API_KEY'), 'oc_sk_newer')
}

console.log('16) dryRun не переносит заменённый ключ в маршрут')
{
  const w = makeWorld({
    keys: { OPENCODE_GO_API_KEY: 'sk-old', OPENCODE_GO_KEY_ACTIVE: 'go1', OPENCODE_GO_KEY_go1: 'oc_sk_new' },
    usage: { oc_sk_new: usageOf(3, 6, 3) }, dryRun: true,
  })
  await settle()
  check('маршрут не изменён', w.store.get('OPENCODE_GO_API_KEY'), 'sk-old')
}

console.log('17) сетевой сбой проверки не переносит неизвестный ключ в маршрут')
{
  const w = makeWorld({
    keys: { OPENCODE_GO_API_KEY: 'sk-old', OPENCODE_GO_KEY_ACTIVE: 'go1', OPENCODE_GO_KEY_go1: 'oc_sk_new' },
    usage: { oc_sk_new: 'network' },
  })
  await settle()
  check('маршрут не изменён', w.store.get('OPENCODE_GO_API_KEY'), 'sk-old')
}

console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРОШЛИ' : `\nПРОВАЛЕНО: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
