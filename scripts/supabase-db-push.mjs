import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const envPath = resolve(process.cwd(), '.env')
const env = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key, value]) => key && !key.startsWith('=') && value !== undefined)
    .map(([key, value]) => [key, String(value)]),
)

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    const value = rawValue.replace(/^["']|["']$/g, '')

    if (key && !key.startsWith('=') && !env[key]) {
      env[key] = value
    }
  }
}

if (!env.SUPABASE_DB_PASSWORD) {
  console.error('Missing SUPABASE_DB_PASSWORD in .env.')
  console.error('Add SUPABASE_DB_PASSWORD=your_database_password, then run npm run db:push again.')
  process.exit(1)
}

const command = process.platform === 'win32' ? 'cmd.exe' : 'npx'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npx supabase db push --linked']
  : ['supabase', 'db', 'push', '--linked']
const childEnv = process.platform === 'win32'
  ? {
      APPDATA: env.APPDATA,
      ComSpec: env.ComSpec,
      LOCALAPPDATA: env.LOCALAPPDATA,
      Path: env.Path ?? env.PATH,
      SYSTEMROOT: env.SYSTEMROOT,
      TEMP: env.TEMP,
      TMP: env.TMP,
      USERPROFILE: env.USERPROFILE,
      SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD,
    }
  : env
const safeChildEnv = Object.fromEntries(
  Object.entries(childEnv).filter(([, value]) => value !== undefined),
)
const child = spawn(command, args, {
  env: safeChildEnv,
  shell: false,
  stdio: 'inherit',
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
