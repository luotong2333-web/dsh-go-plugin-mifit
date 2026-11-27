// Paths and process helpers shared by the local-mifit plugin.
//
// The plugin keeps everything it produces inside its own directory (runtime/),
// so installing it on a phone that never met this project needs no setup step
// by the user: the sidecar creates the runtime, installs `mifit` into it and
// writes its progress under runtime/state/.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))

// The plugin package root: lib/ sits directly under it.
export const PLUGIN_DIR = dirname(LIB_DIR)
export const HOME = process.env.DSH_MIFIT_HOME || join(PLUGIN_DIR, 'runtime')
export const SITE = join(HOME, 'site')
export const STATE = join(HOME, 'state')
export const BRIDGE = join(LIB_DIR, 'py', 'mifit_bridge.py')
export const PYTHON = process.env.DSH_MIFIT_PYTHON || 'python3'

// The manifest the chat-bar toggle edits; a test points it at a copy.
const MANIFEST = process.env.DSH_MIFIT_MANIFEST || join(PLUGIN_DIR, 'package.json')
const CHIPS_BACKUP = join(HOME, 'composer-chips.json')

// The chat-bar contributions this plugin ships, put back when the user turns
// the toggle on again and no earlier copy was saved.
const DEFAULT_CHIPS = {
  strip: [{ id: 'today', icon: 'heart', panel: 'mifit' }],
  actions: [
    { id: 'open-health', label: { zh: '健康', en: 'Health' }, icon: 'heart' },
    { id: 'refresh-data', label: { zh: '刷新健康', en: 'Refresh' }, icon: 'refresh' },
  ],
}

export const SESSION_FILE = join(
  process.env.DSH_MIFIT_SESSION || join(homedir(), '.mifit'),
  'session.json',
)

// What one refresh pulls. `profile` is read by its own mifit command.
export const DOMAINS = [
  'steps',
  'sleep',
  'heart_rate_daily',
  'spo2_daily',
  'stress_daily',
  'weight',
  'workouts',
  'profile',
]

function pickDataDir() {
  if (process.env.DSH_MIFIT_DATA) return process.env.DSH_MIFIT_DATA
  // This phone already exported here before the plugin existed; keep reading it.
  const legacy = '/root/workspace/mifit-data'
  return existsSync(legacy) ? legacy : join(HOME, 'data')
}

export const DATA = pickDataDir()

export function ensureDirs() {
  for (const dir of [HOME, SITE, STATE, DATA]) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // A read-only home is reported by the sidecar state, not thrown here.
    }
  }
}

export function readState(name) {
  try {
    return JSON.parse(readFileSync(join(STATE, name), 'utf8'))
  } catch {
    return null
  }
}

export function runtimeReady() {
  return existsSync(join(SITE, 'mifit', '__init__.py'))
}

export function sessionState() {
  try {
    const parsed = JSON.parse(readFileSync(SESSION_FILE, 'utf8'))
    return {
      present: true,
      valid: Boolean(parsed?.service_token && parsed?.user_id),
      createdAt: parsed?.created_at ?? null,
      renewedAt: parsed?.renewed_at ?? null,
    }
  } catch {
    return { present: false, valid: false, createdAt: null, renewedAt: null }
  }
}

// Newest export on disk, as a timestamp; 0 when nothing has been fetched yet.
export function dataDate() {
  let newest = 0
  for (const domain of DOMAINS) {
    try {
      newest = Math.max(newest, statSync(join(DATA, `${domain}.json`)).mtimeMs)
    } catch {
      // A missing domain file is normal before the first fetch.
    }
  }
  return newest
}

// The sport key of each workout, as the sidecar copied it off the record
// envelope (`{"kinds": {"1795418067": "elliptical_trainer"}}`), or null when
// the file is not there yet.
export function readWorkoutKinds() {
  try {
    const parsed = JSON.parse(readFileSync(join(DATA, 'workout_kinds.json'), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.kinds || typeof parsed.kinds !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

// The QR code the sidecar wrote, as a data URL the panel can draw. The view
// budget is 64 KiB, so a larger PNG is dropped rather than truncated.
export function qrDataUrl() {
  try {
    const raw = readFileSync(join(STATE, 'qr.png'))
    if (raw.length === 0 || raw.length > 40000) return ''
    return `data:image/png;base64,${raw.toString('base64')}`
  } catch {
    return ''
  }
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'))
  } catch {
    return null
  }
}

// Whether the strip and the chips still appear above the composer.
export function chipsEnabled() {
  const manifest = readManifest()
  const contributes = manifest?.dshGo?.contributes ?? {}
  return (
    Array.isArray(contributes['composer.strip']) || Array.isArray(contributes['composer.actions'])
  )
}

// The switch above the composer is just its manifest: the app re-reads
// package.json when it changes, so removing the two contributions hides the
// strip and the chips, and putting them back brings them in again.
export function setChips(enabled) {
  const manifest = readManifest()
  if (!manifest) return false
  if (!manifest.dshGo || typeof manifest.dshGo !== 'object') manifest.dshGo = {}
  const contributes =
    manifest.dshGo.contributes && typeof manifest.dshGo.contributes === 'object'
      ? manifest.dshGo.contributes
      : {}
  ensureDirs()

  if (enabled) {
    let saved = null
    try {
      saved = JSON.parse(readFileSync(CHIPS_BACKUP, 'utf8'))
    } catch {
      // Nothing was saved: the shipped contributions come back.
    }
    const strip = Array.isArray(saved?.strip) && saved.strip.length > 0 ? saved.strip : DEFAULT_CHIPS.strip
    const actions =
      Array.isArray(saved?.actions) && saved.actions.length > 0 ? saved.actions : DEFAULT_CHIPS.actions
    contributes['composer.strip'] = strip
    contributes['composer.actions'] = actions
  } else {
    const saved = {
      strip: Array.isArray(contributes['composer.strip']) ? contributes['composer.strip'] : null,
      actions: Array.isArray(contributes['composer.actions']) ? contributes['composer.actions'] : null,
    }
    try {
      writeFileSync(CHIPS_BACKUP, `${JSON.stringify(saved, null, 2)}\n`)
    } catch {
      // Without the backup the shipped contributions still come back.
    }
    delete contributes['composer.strip']
    delete contributes['composer.actions']
  }

  manifest.dshGo.contributes = contributes
  try {
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  } catch {
    return false
  }
  return true
}

function bridgeEnv() {
  const env = { ...process.env, PYTHONUNBUFFERED: '1' }
  const sep = process.platform === 'win32' ? ';' : ':'
  env.PYTHONPATH = [SITE, env.PYTHONPATH].filter(Boolean).join(sep)
  return env
}

function bridgeArgs(command, extra) {
  return [BRIDGE, command, '--home', HOME, '--data', DATA, ...extra]
}

// Starts a sidecar command and returns at once; the panel follows its state file.
export function spawnBridge(command, extra = []) {
  ensureDirs()
  const child = spawn(PYTHON, bridgeArgs(command, extra), {
    env: bridgeEnv(),
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return child.pid
}

// Runs a short sidecar command and resolves `{ code, stdout, stderr }`.
export function runBridge(command, extra = [], timeoutMs = 20000) {
  ensureDirs()
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    let child
    try {
      child = spawn(PYTHON, bridgeArgs(command, extra), {
        env: bridgeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ code: -1, stdout: '', stderr: String(error) })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
      finish({ code: -1, stdout, stderr: stderr || 'timeout' })
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ code: -1, stdout, stderr: String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ code: code ?? -1, stdout, stderr })
    })
  })
}
