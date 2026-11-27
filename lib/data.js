// Reads the JSON that `mifit export` wrote and flattens it for the panel.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { kindLabel } from './kinds.js'

function readRecords(dir, file) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'))
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

// `stored` is the sidecar's `workout_kinds.json` (sport keys by start time), or
// null before the first fetch wrote one.
export function snapshot(dir, stored = null) {
  const profile = readRecords(dir, 'profile.json')[0] ?? {}
  const steps = readRecords(dir, 'steps.json')
  const sleep = firstWith(readRecords(dir, 'sleep.json'), 'asleep_min')
  const heartRows = readRecords(dir, 'heart_rate_daily.json')
  const heart = firstWith(heartRows, 'resting_bpm') ?? firstWith(heartRows, 'avg_bpm')
  const spo2 = firstWith(readRecords(dir, 'spo2_daily.json'), 'avg_spo2_pct')
  const stress = firstWith(readRecords(dir, 'stress_daily.json'), 'avg_stress_level')
  const weight = firstWith(readRecords(dir, 'weight.json'), 'weight_kg')
  const workouts = readRecords(dir, 'workouts.json')
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
      ? {
          date: heart.date,
          resting: num(heart.resting_bpm),
          avg: num(heart.avg_bpm),
          min: num(heart.min_bpm),
          max: num(heart.max_bpm),
        }
      : null,
    spo2: spo2 ? { date: spo2.date, avg: num(spo2.avg_spo2_pct), min: num(spo2.min_spo2_pct) } : null,
    stress: stress
      ? { date: stress.date, avg: num(stress.avg_stress_level), max: num(stress.max_stress_level) }
      : null,
    weight: weight ? { weightKg: num(weight.weight_kg), bmi: num(weight.bmi) } : null,
    workouts: workouts.slice(0, 5).map((row) => ({
      start: num(row.start_epoch_s),
      code: num(row.source_sport_code),
      sport: kindLabel(row, stored, 'zh-CN'),
      sportEn: kindLabel(row, stored, 'en-US'),
      durationMin: num(row.duration_s) == null ? null : Math.round(row.duration_s / 60),
      kcal: num(row.total_kcal),
      avgHr: num(row.avg_hr_bpm),
    })),
  }
}
