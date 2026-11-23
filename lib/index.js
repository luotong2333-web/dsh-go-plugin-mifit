// A local dsh-go plugin: Xiaomi Mi Fitness (mifit) health data.
// The app draws what package.json "dshGo" declares; this code supplies the
// strip text, the panel view and the refresh action. Everything is read from
// the local JSON that `mifit export` already wrote.
import { refresh, snapshot } from './data.js'

export const name = 'local-mifit'

const STRIP_INTERVAL_MS = 5 * 60 * 1000
const REFRESH_TIMEOUT_MS = 45000

function isEn(locale) {
  return String(locale ?? '').startsWith('en')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function shortDate(iso) {
  const parts = String(iso ?? '').split('-')
  if (parts.length !== 3) return String(iso ?? '')
  return `${Number(parts[1])}/${Number(parts[2])}`
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

function stripPayload(data, en) {
  const head = `${en ? 'Today' : '今日'} ${data.steps} ${en ? 'steps' : '步'}`
  let text = head
  const asleep = data.sleep?.asleepMin
  if (asleep != null) {
    const hours = Math.floor(asleep / 60)
    const minutes = Math.round(asleep % 60)
    text = `${head} · ${en ? 'sleep' : '睡'} ${hours}h${pad(minutes)}m`
  }
  const payload = { text: text.slice(0, 24), icon: 'heart' }
  const ratio = data.goal > 0 ? data.steps / data.goal : 0
  if (ratio >= 1) payload.tone = 'good'
  else if (ratio < 0.4) payload.tone = 'warn'
  return payload
}

function buildView(locale) {
  const en = isEn(locale)
  const data = snapshot()
  const ratio = data.goal > 0 ? data.steps / data.goal : 0
  const percent = Math.round(Math.min(1, ratio) * 100)

  const progress = {
    type: 'progress',
    value: data.steps,
    max: data.goal,
    label: en ? 'Daily step goal' : '每日步数目标',
  }
  if (data.date) progress.caption = en ? `Data date ${data.date}` : `数据日期 ${data.date}`
  if (ratio >= 1) progress.tone = 'good'

  const children = [
    {
      type: 'metric',
      label: en ? 'Steps today' : '今日步数',
      value: `${data.steps}`,
      tone: ratio >= 1 ? 'good' : ratio < 0.4 ? 'warn' : 'info',
      caption: en ? `Goal ${data.goal} · ${percent}%` : `目标 ${data.goal} 步 · ${percent}%`,
    },
    progress,
    {
      type: 'chart',
      kind: 'bar',
      categories: data.recent.map((row) => shortDate(row.date)),
      series: [{ name: en ? 'Steps' : '步数', values: data.recent.map((row) => row.steps) }],
      unit: en ? 'steps' : '步',
      caption: en ? 'Last 7 days' : '最近 7 天',
    },
  ]

  const rows = []
  if (data.sleep?.asleepMin != null) rows.push([en ? 'Sleep' : '睡眠', durationLabel(data.sleep.asleepMin, en)])
  if (data.sleep?.deepMin != null) rows.push([en ? 'Deep sleep' : '深睡', durationLabel(data.sleep.deepMin, en)])
  if (data.heart) {
    const bits = []
    if (data.heart.resting != null) bits.push(`${en ? 'resting' : '静息'} ${data.heart.resting}`)
    if (data.heart.avg != null) bits.push(`${en ? 'avg' : '平均'} ${data.heart.avg}`)
    if (data.heart.min != null && data.heart.max != null) bits.push(`${data.heart.min}–${data.heart.max}`)
    rows.push([en ? 'Heart rate' : '心率', bits.length ? `${bits.join(' · ')} ${en ? 'bpm' : '次/分'}` : '—'])
  }
  if (data.spo2?.avg != null) {
    const low = data.spo2.min != null ? (en ? ` (min ${data.spo2.min}%)` : `（最低 ${data.spo2.min}%）`) : ''
    rows.push([en ? 'Blood oxygen' : '血氧', `${data.spo2.avg}%${low}`])
  }
  if (data.stress?.avg != null) {
    const high = data.stress.max != null ? (en ? ` (max ${data.stress.max})` : `（最高 ${data.stress.max}）`) : ''
    rows.push([en ? 'Stress' : '压力', `${data.stress.avg}${high}`])
  }
  if (data.weight?.weightKg != null) {
    const bmi = data.weight.bmi != null ? ` · BMI ${data.weight.bmi}` : ''
    rows.push([en ? 'Weight' : '体重', `${data.weight.weightKg} kg${bmi}`])
  }
  if (rows.length) children.push({ type: 'keyValue', items: rows })

  if (data.workouts.length) {
    children.push({ type: 'text', text: en ? 'Recent workouts' : '最近运动' })
    children.push({
      type: 'table',
      columns: en ? ['Time', 'Duration', 'Avg HR', 'Kcal'] : ['时间', '时长', '均心率', '消耗'],
      rows: data.workouts.map((row) => [
        clockLabel(row.start),
        row.durationMin == null ? '—' : `${row.durationMin} ${en ? 'min' : '分钟'}`,
        row.avgHr == null ? '—' : `${row.avgHr}`,
        row.kcal == null ? '—' : `${row.kcal}`,
      ]),
    })
  }

  children.push({
    type: 'actions',
    items: [{ label: en ? 'Reload' : '重新读取', action: 'reload', icon: 'refresh', style: 'primary' }],
  })
  children.push({
    type: 'callout',
    text: en
      ? 'Reads the local mifit export. Use the Refresh chip above the input box to pull new data.'
      : '读取本机 mifit 导出的数据；要拉取新数据，点输入框上方的「刷新健康」。',
    tone: 'info',
  })

  return { type: 'stack', title: en ? 'Mi Fitness' : '小米健康', children }
}

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.on('open-health', () => ({ open: 'panel:mifit' }))

    ctx.dshGo.on('refresh-data', (scope, event) => ({
      pending: {
        label: isEn(event?.locale) ? 'Fetching health data' : '正在拉取健康数据',
        timeoutMs: REFRESH_TIMEOUT_MS + 10000,
      },
      result: async () => {
        const outcome = await refresh({ days: 7, timeoutMs: REFRESH_TIMEOUT_MS })
        if (outcome.ok) return { toast: isEn(event?.locale) ? 'Health data updated' : '健康数据已更新' }
        return { toast: isEn(event?.locale) ? 'Fetch failed; cached data stays' : '拉取失败，仍用本地数据' }
      },
    }))

    ctx.dshGo.strip('today', (scope, emit, caps) => {
      const en = isEn(caps?.locale)
      const push = () => emit(stripPayload(snapshot(), en))
      push()
      const timer = setInterval(push, STRIP_INTERVAL_MS)
      return () => clearInterval(timer)
    })

    ctx.dshGo.panel('mifit', {
      view: (scope, caps) => buildView(caps?.locale),
      actions: {
        reload: (scope, event) => ({
          refresh: true,
          toast: isEn(event?.locale) ? 'Reloaded local data' : '已重新读取本地数据',
        }),
      },
    })
  })
}
