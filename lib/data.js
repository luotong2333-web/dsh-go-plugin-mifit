// Reads the JSON that `mifit export` writes and refreshes it on demand.
// Locations can be overridden with DSH_MIFIT_DATA / DSH_MIFIT_BIN.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = process.env.DSH_MIFIT_DATA || '/root/workspace/mifit-data'
const MIFIT_BIN = process.env.DSH_MIFIT_BIN || '/root/workspace/.venvs/mifit/bin/mifit'

function readRecords(file) {
  try {
    const parsed = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'))
    return Array.isArray(parsed?.records) ? parsed.records : []
  } catch {
    return []
  }
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function firstWith(list, key) {
  return list.find((row) => num(row?.[key]) != null) ?? null
}

export function ymd(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function snapshot() {
  const profile = readRecords('profile.json')[0] ?? {}
  const steps = readRecords('steps.json')
  const sleep = firstWith(readRecords('sleep.json'), 'asleep_min')
  const heart = firstWith(readRecords('heart_rate_daily.json'), 'resting_bpm') ?? firstWith(readRecords('heart_rate_daily.json'), 'avg_bpm')
  const spo2 = firstWith(readRecords('spo2_daily.json'), 'avg_spo2_pct')
  const stress = firstWith(readRecords('stress_daily.json'), 'avg_stress_level')
  const weight = firstWith(readRecords('weight.json'), 'weight_kg')
  const workouts = readRecords('workouts.json')
  const today = steps.find((row) => row?.date === ymd(new Date())) ?? steps[0] ?? {}

  return {
    date: today.date ?? '',
    steps: num(today.steps) ?? 0,
    goal: num(profile.step_goal) ?? 10000,
    distanceKm: num(today.distance_m) == null ? null : Math.round(today.distance_m / 100) / 10,
    kcal: num(today.step_calories),
    recent: steps.slice(0, 7).reverse().map((row) => ({ date: row.date, steps: num(row.steps) ?? 0 })),
    sleep: sleep
      ? { date: sleep.date, asleepMin: num(sleep.asleep_min), deepMin: num(sleep.deep_min) }
      : null,
    heart: heart
      ? { date: heart.date, resting: num(heart.resting_bpm), avg: num(heart.avg_bpm), min: num(heart.min_bpm), max: num(heart.max_bpm) }
      : null,
    spo2: spo2 ? { date: spo2.date, avg: num(spo2.avg_spo2_pct), min: num(spo2.min_spo2_pct) } : null,
    stress: stress ? { date: stress.date, avg: num(stress.avg_stress_level), max: num(stress.max_stress_level) } : null,
    weight: weight ? { weightKg: num(weight.weight_kg), bmi: num(weight.bmi) } : null,
    workouts: workouts.slice(0, 5).map((row) => ({
      start: num(row.start_epoch_s),
      durationMin: num(row.duration_s) == null ? null : Math.round(row.duration_s / 60),
      kcal: num(row.total_kcal),
      avgHr: num(row.avg_hr_bpm),
    })),
  }
}

export const REFRESH_DOMAINS = [
  'steps',
  'sleep',
  'heart_rate_daily',
  'spo2_daily',
  'stress_daily',
  'weight',
  'workouts',
]

// Exports each domain in turn, writing straight over the cached JSON files.
// Resolves { ok, failures }; never rejects, so a slow network cannot hang a tap.
export function refresh({ days = 7, timeoutMs = 45000 } = {}) {
  const to = new Date()
  const from = new Date(to.getTime() - days * 86400000)
  const range = ['--from', ymd(from), '--to', ymd(to)]
  const queue = REFRESH_DOMAINS.slice()
  const failures = []
  const started = Date.now()

  return new Promise((resolve) => {
    const next = () => {
      if (Date.now() - started > timeoutMs) {
        failures.push('timeout')
        return resolve({ ok: false, failures })
      }
      const domain = queue.shift()
      if (!domain) return resolve({ ok: failures.length === 0, failures })
      execFile(
        MIFIT_BIN,
        ['export', domain, ...range, '--json', join(DATA_DIR, `${domain}.json`)],
        { timeout: timeoutMs },
        (error) => {
          if (error) failures.push(domain)
          next()
        },
      )
    }
    next()
  })
}
