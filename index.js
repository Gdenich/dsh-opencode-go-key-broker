/**
 * dsh-opencode-go-key-broker — Host half
 * ---------------------------------------------------------------------------
 * Автоматическое переключение ключей OpenCode Go по состоянию квот.
 *
 * Идея: DSH резолвит ключ маршрута из credentials ПЕРЕД КАЖДЫМ запросом
 * (`dsh-llm-pi-ai`: `credentials.resolve(profile.apiKeyEnv)` внутри
 * `prepareCall`), поэтому достаточно менять значение одного рефа
 * `OPENCODE_GO_API_KEY` — маршруты, модели и адаптер трогать не нужно.
 *
 * Пул живёт как конвенция (её же читает виджет dsh-opencode-go-usage):
 *   OPENCODE_GO_KEY_<name>: sk-...      — ключи пула
 *   OPENCODE_GO_KEY_ACTIVE: <name>      — пометка активного (★ в виджете)
 *   OPENCODE_GO_API_KEY: sk-...         — то, что реально читает маршрут
 *
 * Две ветки переключения:
 *   1. Превентивная — опрос `GET /v1/usage` раз в refreshMs; если активный
 *      ключ «красный» (status !== ok или percent >= порога), берём следующий
 *      зелёный и остаёмся на нём (sticky), пока он не покраснеет.
 *   2. Реактивная — waterfall `agent/request-error`: при `QUOTA` /
 *      `INVALID_CREDENTIAL` меняем ключ и возвращаем `{ kind: 'retry' }`,
 *      агент-луп переподготовит запрос и перерезолвит креденшел — повтор
 *      идёт уже с новым ключом, в том же ходу.
 *
 * Запись идёт через `credentials.set/unset` (dsh-credentials-local): тот же
 * кросс-процессный лок, что у страницы Models, поэтому ручные правки и UI
 * не затирают друг друга.
 *
 * Значения ключей не покидают Host: наружу (snapshot/settings-таб) уходят
 * только имена, маски, проценты и статусы.
 */
import { readFileSync, existsSync } from 'node:fs'
import { appendFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const DEFAULT_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const ACTIVE_REF = 'OPENCODE_GO_API_KEY'
const MARKER_REF = 'OPENCODE_GO_KEY_ACTIVE'
const POOL_PREFIX = 'OPENCODE_GO_KEY_'
const ROUTE_BASE = '/plugins/dsh-opencode-go-key-broker'
const LOG_LIMIT = 40
const DIAG_LIMIT_BYTES = 256 * 1024
const SWITCH_BUDGET = 3
const SWITCH_WINDOW_MS = 60_000

/** Маска ключа: наружу уходит только узнаваемая рамка, не значение. */
function mask(value) {
  const s = String(value ?? '')
  if (s.length <= 14) return s.length > 6 ? s.slice(0, 3) + '…' + s.slice(-2) : '…'
  return s.slice(0, 8) + '…' + s.slice(-6)
}

/** Один предикат «запрос пришёл с этой машины и с этого же origin». */
function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = req.headers?.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        resolve(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.length === 0) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

function pickWindow(w) {
  if (!w || typeof w !== 'object') return { status: null, percent: null, resetsAt: null }
  const p = typeof w.percent === 'number' ? w.percent : Number(w.percent)
  return {
    status: typeof w.status === 'string' ? w.status : null,
    percent: Number.isFinite(p) ? p : null,
    resetsAt: typeof w.resetsAt === 'string' ? w.resetsAt : null,
  }
}

export const name = 'opencode-go-key-broker'
export const inject = ['credentials', 'timer']

export default {
  name,
  inject,
  apply(ctx, config = {}) {
    const enabled = config.enabled !== false
    const dryRun = config.dryRun === true
    const usageUrl = config.usageUrl || DEFAULT_USAGE_URL
    const refreshMs = config.refreshMs || 60_000
    const timeoutMs = config.timeoutMs || 15_000
    const sticky = config.sticky !== false
    const prefer = config.prefer === 'headroom' ? 'headroom' : 'first'
    const switchOnError = config.switchOnError !== false
    // Ограничить реактивную ветку своими маршрутами: чужой провайдер не должен
    // Menять ключ OpenCode Go из-за своей ошибки авторизации или квоты.
    const reactProviders = Array.isArray(config.reactProviders) ? config.reactProviders.map(String) : null
    const redOnStatus = config.redOnStatus !== false
    const warnPercent = config.warnPercent ?? 80
    // Порог «красного» окна. 98% — запас на один-два запроса до жёсткого
    // лимита провайдера; ниже него ключ остаётся рабочим и брокер его не
    // трогает (переключение возможно только на «не красный» кандидат).
    const thresholds = {
      rolling: config.thresholds?.rolling ?? 98,
      weekly: config.thresholds?.weekly ?? 98,
      monthly: config.thresholds?.monthly ?? 98,
    }
    const dshHome = config.dshHome || resolveDshHome()
    const credPath = join(dshHome, '.credentials.yaml')

    /**
     * Имена пула: конфиг, иначе скан файла креденшелов (ACTIVE не ключ).
     *
     * Раскладка файла: `dsh-credentials-local` держит ссылки вложенно под
     * `refs:` — то есть строка выглядит как `  OPENCODE_GO_KEY_go1: sk-…`
     * с двумя пробелами отступа. Прежний шаблон с `^` без отступа находил
     * только плоский (дореформенный) документ и на текущем не видел пул
     * вообще. Ровно два пробела — это запись ссылки; более глубокие
     * отступы относятся к `records[].payload` и ключами пула не являются.
     */
    function discoverKeyNames() {
      if (Array.isArray(config.keyNames) && config.keyNames.length > 0) return config.keyNames.slice()
      let text = ''
      try {
        if (existsSync(credPath)) text = readFileSync(credPath, 'utf8')
      } catch {
        /* файл недоступен — пул пуст */
      }
      const names = []
      for (const m of text.matchAll(/^(?: {2})?OPENCODE_GO_KEY_([A-Za-z0-9_]+)\s*:/gm)) {
        if (m[1] !== 'ACTIVE' && !names.includes(m[1])) names.push(m[1])
      }
      return names
    }

    const log = []
    let cache = { updatedAt: 0, keys: [], activeName: null, state: 'init', error: null }
    let refreshing = null
    let appliedName = null
    const switchTimes = []

    // Ключ может проходить `/v1/usage` и при этом не иметь права звать модели
    // (OpenCode отвечает 403 permission_error «This API key can't call models»).
    // Квота такого ключа выглядит здоровой, поэтому без отдельной пометки
    // брокер считал бы его лучшим кандидатом. Карантин снимается сам по
    // времени или сразу, если значение под этим именем заменили.
    const quarantined = new Map()
    const QUARANTINE_MS = 30 * 60_000

    function quarantine(name, value, reason) {
      if (typeof name !== 'string') return
      quarantined.set(name, { until: Date.now() + QUARANTINE_MS, value, reason })
      note('quarantine', { to: name, reason })
    }

    function quarantineReason(entry) {
      if (!entry || typeof entry.name !== 'string') return null
      const mark = quarantined.get(entry.name)
      if (mark === undefined) return null
      if (mark.value !== entry.value) {
        quarantined.delete(entry.name)
        return null
      }
      if (mark.until <= Date.now()) {
        quarantined.delete(entry.name)
        return null
      }
      return mark.reason
    }

    function note(action, detail) {
      log.unshift({ at: Date.now(), action, ...detail })
      if (log.length > LOG_LIMIT) log.length = LOG_LIMIT
    }

    async function fetchUsage(key) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await fetch(usageUrl, {
          headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
          signal: ctrl.signal,
        })
        if (res.status === 401) return { error: 'unauthorized' }
        if (!res.ok) return { error: 'http-' + res.status }
        let data
        try {
          data = await res.json()
        } catch {
          return { error: 'bad-json' }
        }
        const usage = data && typeof data === 'object' && data.usage ? data.usage : data
        if (!usage || typeof usage !== 'object') return { error: 'bad-json' }
        return {
          error: null,
          windows: {
            rolling: pickWindow(usage.rolling),
            weekly: pickWindow(usage.weekly),
            monthly: pickWindow(usage.monthly),
          },
        }
      } catch (e) {
        const aborted = e && e.name === 'AbortError'
        return { error: aborted ? 'timeout' : 'network' }
      } finally {
        clearTimeout(timer)
      }
    }

    /** Уровень ключа: red — пора уходить; warn — запас кончается; unknown — сеть. */
    function classify(entry) {
      const quarantinedFor = quarantineReason(entry)
      if (quarantinedFor !== null) return { level: 'red', reason: `auth failed (${quarantinedFor})`, worst: null }
      if (entry.error === 'unauthorized') return { level: 'red', reason: 'invalid key (401)', worst: null }
      if (entry.error) return { level: 'unknown', reason: entry.error, worst: null }
      const windows = entry.windows || {}
      let worst = null
      for (const key of ['rolling', 'weekly', 'monthly']) {
        const w = windows[key]
        if (!w) continue
        if (redOnStatus && w.status !== null && w.status !== 'ok') {
          return { level: 'red', reason: `${key}: status ${w.status}`, worst: { window: key, percent: w.percent } }
        }
        if (w.percent !== null && w.percent >= (thresholds[key] ?? 100)) {
          return { level: 'red', reason: `${key}: ${w.percent}% >= ${thresholds[key]}%`, worst: { window: key, percent: w.percent } }
        }
        if (worst === null || (w.percent ?? -1) > (worst.percent ?? -1)) worst = { window: key, percent: w.percent }
      }
      const level = worst && worst.percent !== null && worst.percent >= warnPercent ? 'warn' : 'ok'
      return { level, reason: level === 'warn' ? `${worst.window}: ${worst.percent}%` : 'ok', worst }
    }

    function headroom(entry) {
      const windows = entry.windows || {}
      let min = 100
      for (const key of ['rolling', 'weekly', 'monthly']) {
        const p = windows[key]?.percent
        if (typeof p === 'number') min = Math.min(min, 100 - p)
      }
      return min
    }

    /** Кого ставить активным: sticky — держим текущего, пока он не красный. */
    function chooseNext(keys, currentName, currentLevel) {
      const rank = (entry) => (prefer === 'headroom' ? -headroom(entry) : keys.findIndex((k) => k.name === entry.name))
      const usable = keys.filter((entry) => classify(entry).level !== 'red' && entry.error === null)
      if (currentName !== null && sticky && currentLevel !== 'red') return null
      if (usable.length === 0) return null
      const current = keys.find((k) => k.name === currentName)
      if (current && currentLevel !== 'red' && sticky) return null
      const candidates = usable.filter((entry) => entry.name !== currentName)
      const pool = candidates.length > 0 ? candidates : usable
      pool.sort((a, b) => rank(a) - rank(b))
      return pool[0] ?? null
    }

    function withinBudget() {
      const now = Date.now()
      while (switchTimes.length > 0 && now - switchTimes[0] > SWITCH_WINDOW_MS) switchTimes.shift()
      return switchTimes.length < SWITCH_BUDGET
    }

    async function applyActive(name_, value, reason) {
      if (dryRun) {
        note('would-switch', { to: name_, reason, dryRun: true })
        appliedName = name_
        return true
      }
      if (!withinBudget()) {
        note('switch-suppressed', { to: name_, reason, why: 'budget' })
        return false
      }
      await ctx.credentials.set(credentialRef(ACTIVE_REF), value)
      await ctx.credentials.set(credentialRef(MARKER_REF), name_)
      switchTimes.push(Date.now())
      appliedName = name_
      note('switch', { to: name_, reason, masked: mask(value) })
      return true
    }

    async function resolvePool() {
      const names = discoverKeyNames()
      const pool = []
      for (const n of names) {
        const hit = await ctx.credentials.resolve(credentialRef(POOL_PREFIX + n))
        if (hit && hit.value) pool.push({ name: n, value: hit.value })
      }
      return pool
    }

    /** Текущий активный: пометка → её имя; иначе совпадение значения с пулом. */
    async function resolveActiveName(pool) {
      const marker = await ctx.credentials.resolve(credentialRef(MARKER_REF))
      const markerName = marker && marker.value ? marker.value : null
      if (markerName && pool.some((k) => k.name === markerName)) return markerName
      const main = await ctx.credentials.resolve(credentialRef(ACTIVE_REF))
      if (main && main.value) {
        const hit = pool.find((k) => k.value === main.value)
        if (hit) return hit.name
      }
      return null
    }

    async function refresh() {
      if (refreshing) return refreshing
      refreshing = (async () => {
        try {
          if (!enabled) {
            cache = { ...cache, updatedAt: Date.now(), state: 'disabled' }
            return
          }
          const pool = await resolvePool()
          if (pool.length === 0) {
            cache = { updatedAt: Date.now(), keys: [], activeName: null, state: 'no-pool', error: null }
            return
          }
          const results = await Promise.all(
            pool.map(async (k) => {
              const r = await fetchUsage(k.value)
              return { name: k.name, value: k.value, error: r.error, windows: r.windows || null }
            }),
          )
          const activeName = await resolveActiveName(pool)
          const current = results.find((k) => k.name === activeName)
          const currentLevel = current ? classify(current).level : 'unknown'

          // Пометка активного (`OPENCODE_GO_KEY_ACTIVE`) — конвенция виджета
          // usage: он рисует ★ по ней. Если активный определён по значению
          // (маршрут уже указывает на ключ пула), а пометки нет или она
          // устарела, выравниваем её. Ключ маршрута при этом не меняется.
          if (!dryRun && activeName !== null) {
            const markerHit = await ctx.credentials.resolve(credentialRef(MARKER_REF))
            const markerName = markerHit && markerHit.value ? markerHit.value : null
            if (markerName !== activeName) {
              await ctx.credentials.set(credentialRef(MARKER_REF), activeName)
              note('marker-sync', { to: activeName })
            }
          }

          // Замена значения под тем же именем пула (например, перевыпуск
          // истёкшего ключа) не меняет marker. Sticky по имени не должен
          // оставлять старое значение в рефе, который читает модель.
          // Синхронизируем только проверенный, не красный ключ; dryRun и
          // общий бюджет записей соблюдаются внутри applyActive().
          if (current && current.error === null && currentLevel !== 'red') {
            const main = await ctx.credentials.resolve(credentialRef(ACTIVE_REF))
            if (!main || main.value !== current.value) {
              await applyActive(current.name, current.value, 'active pool key value changed')
            }
          }

          // Ручной override: пометку выставили из UI/руками — уважаем её.
          const activeEntry = results.find((k) => k.name === activeName)
          if (activeEntry && activeName !== appliedName && appliedName !== null && currentLevel !== 'red') {
            note('adopt-manual', { to: activeName })
          }

          const next = chooseNext(results, activeName, currentLevel)
          if (next === null && activeName === null) {
            const fallback = results.filter((k) => classify(k).level !== 'red' && k.error === null)
            fallback.sort((a, b) => (prefer === 'headroom' ? headroom(b) - headroom(a) : 0))
            if (fallback[0]) {
              const why = 'no active key: ' + (currentLevel === 'red' ? 'all pool red' : 'unset')
              await applyActive(fallback[0].name, fallback[0].value, why)
            }
          } else if (next !== null) {
            await applyActive(next.name, next.value, classify(current ?? {}).reason || 'active key red')
          }

          cache = {
            updatedAt: Date.now(),
            state: results.every((k) => classify(k).level === 'red') ? 'all-red' : 'ok',
            activeName: appliedName ?? activeName,
            keys: results.map((k) => {
              const verdict = classify(k)
              return {
                name: k.name,
                masked: mask(k.value),
                active: k.name === (appliedName ?? activeName),
                level: verdict.level,
                reason: verdict.reason,
                error: k.error,
                windows: k.windows,
              }
            }),
            error: null,
          }
        } catch (e) {
          cache = { ...cache, updatedAt: Date.now(), error: 'internal: ' + String((e && e.message) || e) }
          note('error', { message: String((e && e.message) || e) })
        }
      })()
      try {
        await refreshing
      } finally {
        refreshing = null
      }
      return cache
    }

    // Реактивная ветка: ключ выдохся или отвергнут в бою — переключаем и
    // повторяем запрос. AUTH — это 401/403 от провайдера (в том числе
    // «This API key can't call models»), такой ключ не спасает и квота.
    ctx.on('agent/request-error', async (payload, next) => {
      const code = payload?.failure?.code
      if (!enabled || !switchOnError) return next()
      if (code !== 'QUOTA' && code !== 'INVALID_CREDENTIAL' && code !== 'AUTH') return next()
      if (Array.isArray(reactProviders) && reactProviders.length > 0 && payload?.provider !== undefined && !reactProviders.includes(String(payload.provider))) return next()
      if (dryRun) {
        await refresh()
        note('would-switch', { reason: `request error ${code}`, dryRun: true })
        return next()
      }
      if (!withinBudget()) {
        await refresh()
        note('switch-suppressed', { reason: `request error ${code}`, why: 'budget' })
        return next()
      }
      // Кто был активным до переоценки: превентивная ветка внутри refresh()
      // могла переключить ключ сама — тогда повтор всё равно нужен.
      const before = cache.keys.find((k) => k.active)?.name ?? null
      // Ключ, который прошёл проверку квоты, но получил 401/403 на запросе,
      // помечаем красным до смены значения или истечения карантина.
      if (before !== null && (code === 'AUTH' || code === 'INVALID_CREDENTIAL')) {
        const failed = (await resolvePool()).find((k) => k.name === before)
        if (failed) quarantine(before, failed.value, code)
      }
      await refresh()
      const after = cache.activeName
      if (after !== null && after !== before) {
        note('retry-after-switch', { from: before, to: after, reason: `request error ${code}` })
        return { kind: 'retry' }
      }
      const candidates = cache.keys.filter((k) => k.level !== 'red' && k.error === null && k.name !== after)
      if (candidates.length === 0) {
        note('no-alternative', { reason: `request error ${code}` })
        return next()
      }
      candidates.sort((a, b) => (prefer === 'headroom' ? headroom(b) - headroom(a) : 0))
      const choice = candidates[0]
      const pool = await resolvePool()
      const entry = pool.find((k) => k.name === choice.name)
      if (!entry) return next()
      const ok = await applyActive(entry.name, entry.value, `request error ${code} (${before ?? 'unknown'})`)
      return ok ? { kind: 'retry' } : next()
    })

    const snapshot = () => ({
      updatedAt: cache.updatedAt,
      state: cache.state,
      error: cache.error,
      active: cache.activeName,
      applied: appliedName,
      enabled,
      dryRun,
      policy: { sticky, prefer, switchOnError, redOnStatus, warnPercent, thresholds, refreshMs, usageUrl },
      activeRef: ACTIVE_REF,
      markerRef: MARKER_REF,
      keys: cache.keys,
      log,
    })

    refresh()
    ctx.interval(() => {
      refresh()
    }, refreshMs)

    const webServer = ctx.get('webServer')
    if (webServer !== undefined) {
      ctx.effect(
        () =>
          webServer.register({
            kind: 'exact',
            path: ROUTE_BASE + '/snapshot',
            handler: async (req, res) => {
              const url = new URL(req.url || '/', 'http://x')
              if (url.searchParams.get('force') === '1') await refresh()
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
              res.end(JSON.stringify(snapshot()))
            },
          }),
        'opencode-go-key-broker: snapshot route',
      )
      ctx.effect(
        () =>
          webServer.register({
            kind: 'exact',
            path: ROUTE_BASE + '/activate',
            handler: async (req, res) => {
              const deny = () => {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('forbidden')
              }
              if (req.method !== 'POST' || !isLoopbackRequest(req)) return deny()
              const body = await readJsonBody(req)
              if (body === undefined || typeof body?.name !== 'string') {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'expected { name }' }))
                return
              }
              const pool = await resolvePool()
              const entry = pool.find((k) => k.name === body.name)
              if (!entry) {
                res.writeHead(404, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'no such key in pool' }))
                return
              }
              if (dryRun) {
                note('would-switch', { to: entry.name, reason: 'manual (settings tab)', dryRun: true })
              } else {
                await ctx.credentials.set(credentialRef(ACTIVE_REF), entry.value)
                await ctx.credentials.set(credentialRef(MARKER_REF), entry.name)
                appliedName = entry.name
                note('switch', { to: entry.name, reason: 'manual (settings tab)', masked: mask(entry.value) })
              }
              await refresh()
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
              res.end(JSON.stringify(snapshot()))
            },
          }),
        'opencode-go-key-broker: activate route',
      )
      ctx.effect(
        () =>
          webServer.register({
            kind: 'exact',
            path: ROUTE_BASE + '/refresh',
            handler: async (req, res) => {
              if (req.method !== 'POST' || !isLoopbackRequest(req)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('forbidden')
                return
              }
              await refresh()
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
              res.end(JSON.stringify(snapshot()))
            },
          }),
        'opencode-go-key-broker: refresh route',
      )
      // Диагностика клиентской половины: пишем в файл рядом с credentials,
      // потому что консоль браузера из плагина не видна.
      const diagPath = join(dshHome, 'opencode-go-key-broker-diag.ndjson')
      let diagBytes = 0
      stat(diagPath)
        .then((info) => {
          diagBytes = info.size
        })
        .catch(() => {})
      ctx.effect(
        () =>
          webServer.register({
            kind: 'exact',
            path: ROUTE_BASE + '/diag',
            handler: async (req, res) => {
              if (req.method !== 'POST' || !isLoopbackRequest(req)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('forbidden')
                return
              }
              const body = await readJsonBody(req)
              const line = JSON.stringify({ receivedAt: new Date().toISOString(), ...(body ?? {}) }) + '\n'
              try {
                // Диагностический файл не должен расти бесконечно: держим хвост.
                if (diagBytes > DIAG_LIMIT_BYTES) {
                  await writeFile(diagPath, '')
                  diagBytes = 0
                }
                await appendFile(diagPath, line)
                diagBytes += Buffer.byteLength(line)
              } catch (error) {
                ctx.logger?.warn?.('key-broker diag write failed: %s', String(error))
              }
              ctx.logger?.info?.('key-broker client diag: %s', line.trim().slice(0, 500))
              res.writeHead(204, { 'Cache-Control': 'no-store' })
              res.end()
            },
          }),
        'opencode-go-key-broker: diag route',
      )
    }
  },
}
