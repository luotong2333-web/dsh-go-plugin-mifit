// The dsh-go side of the local-mifit plugin: the strip, the chips and the
// health panel. The view is built once and every value in it is a binding into
// the object `panelData()` emits, so the App can swap in the QR code and the
// numbers without rebuilding the tree.
import { snapshot } from './data.js'
import {
  DATA,
  DOMAINS,
  dataDate,
  ensureDirs,
  qrDataUrl,
  readState,
  runtimeReady,
  sessionState,
  spawnBridge,
} from './host.js'

export const name = 'local-mifit'

const STRIP_INTERVAL_MS = 60 * 1000
const PANEL_INTERVAL_MS = 3000
const AUTO_FETCH_COOLDOWN_MS = 2 * 60 * 1000
const AUTO_RETRY_MS = 90 * 1000
const LOGIN_STALE_MS = 5 * 60 * 1000
// A 1x1 transparent PNG, shown while there is no QR code to draw.
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

let autoFetchAt = 0
let autoSetupAt = 0
let autoLoginAt = 0

function isEn(locale) {
  return String(locale ?? '').startsWith('en')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function shortDate(iso) {
  const parts = String(iso ?? '').split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : String(iso ?? '')
}

// An ISO time from the sidecar (`2026-11-23T12:20:28+08:00`) as `11/23 12:20`.
function timeLabel(iso) {
  const match = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return String(iso ?? '')
  return `${Number(match[2])}/${Number(match[3])} ${match[4]}:${match[5]}`
}

function clockLabel(epochSeconds) {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return '—'
  const at = new Date(epochSeconds * 1000)
  return `${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

function durationLabel(minutes, en) {
  if (minutes == null) return '—'
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours <= 0) return en ? `${rest} min` : `${rest} 分钟`
  return en ? `${hours} h ${rest} min` : `${hours} 小时 ${rest} 分`
}

function startSetup() {
  ensureDirs()
  spawnBridge('setup')
}

// A login left `pending` by a sidecar that died would block every retry.
function loginIsStale(login) {
  if (login?.status !== 'pending') return false
  const started = Date.parse(String(login.startedAt ?? '')) || 0
  return started === 0 || Date.now() - started > LOGIN_STALE_MS
}

function startLogin() {
  const current = readState('login.json')
  if (current?.status === 'pending' && !loginIsStale(current)) return false
  ensureDirs()
  spawnBridge('login')
  return true
}

function startFetch() {
  if (readState('fetch.json')?.status === 'running') return false
  ensureDirs()
  spawnBridge('fetch', ['--days', '7', '--domains', DOMAINS.join(',')])
  return true
}

// A fresh install needs no taps: install the runtime, then show a QR code. A
// failed setup or a rejected login waits for the user instead of retrying on
// every panel tick.
function maybeAutoStart({ ready, setup, login, session }) {
  const now = Date.now()
  if (!ready) {
    if (setup?.status === 'running') return
    if (setup && setup.status !== 'ok') return
    if (now - autoSetupAt < AUTO_RETRY_MS) return
    autoSetupAt = now
    startSetup()
    return
  }
  if (session.valid) return
  if (login?.status === 'pending' && !loginIsStale(login)) return
  if (login && login.status !== 'expired' && login.status !== 'pending') return
  if (now - autoLoginAt < AUTO_RETRY_MS) return
  autoLoginAt = now
  startLogin()
}

// After a fresh login the phone has no data yet; pull it once, by itself.
function maybeAutoFetch(login, session) {
  const now = Date.now()
  if (!session.valid || login?.status !== 'succeeded') return
  if (now - autoFetchAt < AUTO_FETCH_COOLDOWN_MS) return
  const finished = Date.parse(String(login.finishedAt ?? '')) || 0
  if (finished > 0 && dataDate() >= finished) return
  if (readState('fetch.json')?.status === 'running') return
  autoFetchAt = now
  startFetch()
}

function panelRows(snap, en) {
  const rows = []
  if (snap.sleep?.asleepMin != null) {
    rows.push([en ? 'Sleep' : '睡眠', durationLabel(snap.sleep.asleepMin, en)])
  }
  if (snap.sleep?.deepMin != null) {
    rows.push([en ? 'Deep sleep' : '深睡', durationLabel(snap.sleep.deepMin, en)])
  }
  if (snap.heart) {
    const bits = []
    if (snap.heart.resting != null) bits.push(`${en ? 'resting' : '静息'} ${snap.heart.resting}`)
    if (snap.heart.avg != null) bits.push(`${en ? 'avg' : '平均'} ${snap.heart.avg}`)
    if (snap.heart.min != null && snap.heart.max != null) bits.push(`${snap.heart.min}–${snap.heart.max}`)
    rows.push([
      en ? 'Heart rate' : '心率',
      bits.length ? `${bits.join(' · ')} ${en ? 'bpm' : '次/分'}` : '—',
    ])
  }
  if (snap.spo2?.avg != null) {
    const low = snap.spo2.min == null ? '' : en ? ` (min ${snap.spo2.min}%)` : `（最低 ${snap.spo2.min}%）`
    rows.push([en ? 'Blood oxygen' : '血氧', `${snap.spo2.avg}%${low}`])
  }
  if (snap.stress?.avg != null) {
    const high = snap.stress.max == null ? '' : en ? ` (max ${snap.stress.max})` : `（最高 ${snap.stress.max}）`
    rows.push([en ? 'Stress' : '压力', `${snap.stress.avg}${high}`])
  }
  if (snap.weight?.weightKg != null) {
    const bmi = snap.weight.bmi == null ? '' : ` · BMI ${snap.weight.bmi}`
    rows.push([en ? 'Weight' : '体重', `${snap.weight.weightKg} kg${bmi}`])
  }
  if (rows.length === 0) rows.push([en ? 'Health data' : '健康数据', en ? 'Nothing yet' : '还没有数据'])
  return rows
}

function workoutRows(snap, en) {
  if (snap.workouts.length === 0) return [['—', '—', '—', '—']]
  return snap.workouts.map((row) => [
    clockLabel(row.start),
    row.durationMin == null ? '—' : `${row.durationMin} ${en ? 'min' : '分钟'}`,
    row.avgHr == null ? '—' : `${row.avgHr}`,
    row.kcal == null ? '—' : `${row.kcal}`,
  ])
}

function statusLine({ ready, setup, login, session }, en) {
  if (!ready) {
    if (setup?.status === 'running') return en ? 'Setting up the runtime…' : '正在准备运行环境…'
    if (setup?.status === 'failed') {
      return (en ? 'Runtime setup failed: ' : '运行环境没装好：') + String(setup.message ?? '').slice(0, 50)
    }
    return en ? 'First run: installing the runtime' : '第一次使用：正在准备运行环境'
  }
  if (login?.status === 'pending' && !loginIsStale(login)) return en ? 'Waiting for the QR scan' : '等待扫码登录'
  if (!session.valid) return en ? 'Not signed in: scan the QR code' : '还没登录：扫码登录'
  return en ? 'Signed in' : '已登录'
}

function hintLine({ ready, login, session }, fetchState, en) {
  if (!ready) {
    return en
      ? 'The first run installs the mifit SDK on this phone and needs a network connection; the status updates by itself.'
      : '第一次会在这台手机上自动装运行环境（mifit），需要联网，进度会自己更新。'
  }
  if (login?.status === 'pending' && !loginIsStale(login)) {
    return en
      ? 'Scan with the Mi Fitness app and approve; the panel fills in by itself.'
      : '用小米运动健康 App 扫码并在手机上确认，面板会自己刷新。'
  }
  if (login?.status === 'confirm') {
    return en
      ? 'Xiaomi asks for a security confirmation: finish it on the Xiaomi account page, then sign in again.'
      : '小米要求安全确认：在小米账号页面完成确认后再点一次「扫码登录」。'
  }
  if (login?.status === 'expired') return en ? 'The QR code expired; tap Sign in again.' : '二维码过期了，再点一次「扫码登录」。'
  if (login?.status === 'failed') {
    return (en ? 'Sign-in failed: ' : '登录失败：') + String(login.message ?? '').slice(0, 50)
  }
  if (!session.valid) {
    return en
      ? 'Sign in with your Xiaomi account; the session stays on this phone.'
      : '用小米账号扫码登录，会话只存在这台手机上。'
  }
  if (fetchState?.status === 'running') {
    const done = Array.isArray(fetchState.done) ? fetchState.done.length : 0
    const all = Array.isArray(fetchState.domains) ? fetchState.domains.length : 0
    return en ? `Fetching health data (${done}/${all})…` : `正在拉取健康数据（${done}/${all}）…`
  }
  if (fetchState?.status === 'failed') {
    return en ? 'Fetch failed; showing the data already on this phone.' : '拉取失败，先显示手机上已有的数据。'
  }
  if (fetchState?.status === 'partial') {
    return en ? 'Some data could not be read; showing what arrived.' : '部分数据没拉到，先显示已拿到的。'
  }
  if (fetchState?.finishedAt) {
    return (en ? 'Data updated ' : '数据更新于 ') + timeLabel(fetchState.finishedAt)
  }
  return en ? 'The panel fills in after the first fetch.' : '第一次拉取后这里会有数据。'
}

function panelData(locale) {
  const en = isEn(locale)
  const ready = runtimeReady()
  const setup = readState('setup.json')
  const login = readState('login.json')
  const fetchState = readState('fetch.json')
  const session = sessionState()
  maybeAutoStart({ ready, setup, login, session })
  maybeAutoFetch(login, session)
  const snap = snapshot(DATA)
  const qr = ready && login?.status === 'pending' && !loginIsStale(login) ? qrDataUrl() : ''
  const ratio = snap.goal > 0 ? snap.steps / snap.goal : 0
  const percent = Math.round(Math.min(1, ratio) * 100)
  const tone = !session.valid ? 'info' : ratio >= 1 ? 'good' : ratio < 0.4 ? 'warn' : 'info'

  return {
    status: statusLine({ ready, setup, login, session }, en),
    hint: hintLine({ ready, login, session }, fetchState, en),
    qr: qr || BLANK_PNG,
    qrCaption: qr ? (en ? 'Scan with the Mi Fitness app' : '用小米运动健康 App 扫码') : '',
    steps: String(session.valid ? snap.steps : 0),
    stepsValue: session.valid ? snap.steps : 0,
    goal: snap.goal,
    stepsTone: tone,
    stepsCaption: session.valid
      ? en
        ? `Goal ${snap.goal} · ${percent}%`
        : `目标 ${snap.goal} 步 · ${percent}%`
      : en
        ? 'No data yet'
        : '还没有数据',
    dataDate: snap.date || '—',
    days: snap.recent.map((row) => shortDate(row.date)),
    daySteps: snap.recent.map((row) => row.steps),
    rows: panelRows(snap, en),
    workouts: workoutRows(snap, en),
  }
}

function panelView(locale) {
  const en = isEn(locale)
  return {
    type: 'stack',
    title: en ? 'Mi Fitness' : '小米健康',
    children: [
      { type: 'text', text: { $: 'data.status' } },
      { type: 'image', src: { $: 'data.qr' }, aspect: 1, caption: { $: 'data.qrCaption' } },
      { type: 'callout', text: { $: 'data.hint' }, tone: 'info' },
      {
        type: 'metric',
        label: en ? 'Steps today' : '今日步数',
        value: { $: 'data.steps' },
        tone: { $: 'data.stepsTone' },
        caption: { $: 'data.stepsCaption' },
      },
      {
        type: 'progress',
        value: { $: 'data.stepsValue' },
        max: { $: 'data.goal' },
        label: en ? 'Daily step goal' : '每日步数目标',
        caption: { $: 'data.dataDate' },
      },
      {
        type: 'chart',
        kind: 'bar',
        categories: { $: 'data.days' },
        series: [{ name: en ? 'Steps' : '步数', values: { $: 'data.daySteps' } }],
        unit: en ? 'steps' : '步',
        caption: en ? 'Last 7 days' : '最近 7 天',
      },
      { type: 'keyValue', items: { $: 'data.rows' } },
      {
        type: 'table',
        columns: en ? ['Time', 'Duration', 'Avg HR', 'Kcal'] : ['时间', '时长', '均心率', '消耗'],
        rows: { $: 'data.workouts' },
      },
      {
        type: 'actions',
        items: [
          { label: en ? 'Set up runtime' : '准备环境', action: 'env', icon: 'download' },
          { label: en ? 'Sign in' : '扫码登录', action: 'scan', icon: 'qr', style: 'primary' },
          { label: en ? 'Refresh data' : '刷新数据', action: 'pull', icon: 'refresh' },
          { label: en ? 'Sign in again' : '重新登录', action: 'relogin', icon: 'user' },
        ],
      },
    ],
  }
}

function stripPayload(locale) {
  const en = isEn(locale)
  if (!runtimeReady()) {
    const setup = readState('setup.json')
    const running = setup?.status === 'running'
    const text = en
      ? running
        ? 'Mi Fitness · installing'
        : 'Mi Fitness · set up'
      : running
        ? '小米健康 · 装环境中'
        : '小米健康 · 待准备'
    return { text, icon: 'heart', tone: 'warn' }
  }
  if (!sessionState().valid) {
    return { text: en ? 'Mi Fitness · signed out' : '小米健康 · 未登录', icon: 'heart', tone: 'warn' }
  }
  const data = snapshot(DATA)
  const head = `${en ? 'Today' : '今日'} ${data.steps} ${en ? 'steps' : '步'}`
  let text = head
  if (data.sleep?.asleepMin != null) {
    const hours = Math.floor(data.sleep.asleepMin / 60)
    text = `${head} · ${en ? 'sleep' : '睡'} ${hours}h${pad(Math.round(data.sleep.asleepMin % 60))}m`
  }
  const ratio = data.goal > 0 ? data.steps / data.goal : 0
  const payload = { text: text.slice(0, 24), icon: 'heart' }
  if (ratio >= 1) payload.tone = 'good'
  else if (ratio < 0.4) payload.tone = 'warn'
  return payload
}

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.on('open-health', () => ({ open: 'panel:mifit' }))

    ctx.dshGo.on('refresh-data', (scope, event) => {
      const en = isEn(event?.locale)
      if (!runtimeReady()) {
        startSetup()
        return { open: 'panel:mifit', toast: en ? 'Setting up the runtime first' : '先准备运行环境' }
      }
      if (!sessionState().valid) {
        return { open: 'panel:mifit', toast: en ? 'Sign in first' : '先扫码登录' }
      }
      if (!startFetch()) return { toast: en ? 'Already fetching' : '正在拉取，稍等一下' }
      return { toast: en ? 'Fetching health data' : '开始拉取健康数据' }
    })

    ctx.dshGo.on('scan-login', (scope, event) => {
      const en = isEn(event?.locale)
      if (!runtimeReady()) {
        startSetup()
        return { open: 'panel:mifit', toast: en ? 'Setting up the runtime' : '先准备运行环境' }
      }
      const started = startLogin()
      return {
        open: 'panel:mifit',
        toast: started
          ? en
            ? 'Getting the QR code'
            : '正在获取二维码'
          : en
            ? 'The QR code is already above'
            : '二维码已在上方',
      }
    })

    ctx.dshGo.strip('today', (scope, emit, caps) => {
      const locale = caps?.locale
      const push = () => emit(stripPayload(locale))
      push()
      const timer = setInterval(push, STRIP_INTERVAL_MS)
      return () => clearInterval(timer)
    })

    ctx.dshGo.panel('mifit', {
      view: (scope, caps) => panelView(caps?.locale),
      data: (scope, emit, caps) => {
        const locale = caps?.locale
        const push = () => emit(panelData(locale))
        push()
        const timer = setInterval(push, PANEL_INTERVAL_MS)
        return () => clearInterval(timer)
      },
      actions: {
        env: (scope, event) => {
          const en = isEn(event?.locale)
          if (runtimeReady()) return { toast: en ? 'The runtime is ready' : '运行环境已经就绪' }
          startSetup()
          return { toast: en ? 'Setting up the runtime…' : '开始准备运行环境，稍等一会儿' }
        },
        scan: (scope, event) => {
          const en = isEn(event?.locale)
          if (!runtimeReady()) return { toast: en ? 'Set up the runtime first' : '先点「准备环境」' }
          if (!startLogin()) return { toast: en ? 'The QR code is already above' : '二维码已经在上方了' }
          return { toast: en ? 'Getting the QR code…' : '正在获取二维码，稍等一下' }
        },
        pull: (scope, event) => {
          const en = isEn(event?.locale)
          if (!runtimeReady()) return { toast: en ? 'Set up the runtime first' : '先点「准备环境」' }
          if (!sessionState().valid) return { toast: en ? 'Sign in first' : '先扫码登录' }
          if (!startFetch()) return { toast: en ? 'Already fetching' : '正在拉取，稍等一下' }
          return { toast: en ? 'Fetching the last 7 days' : '开始拉取最近 7 天' }
        },
        relogin: (scope, event) => {
          const en = isEn(event?.locale)
          if (!runtimeReady()) return { toast: en ? 'Set up the runtime first' : '先点「准备环境」' }
          if (!startLogin()) return { toast: en ? 'The QR code is already above' : '二维码已经在上方了' }
          return { toast: en ? 'Getting a new QR code' : '正在获取新的二维码' }
        },
      },
    })
  })
}
