import { appendFileSync } from 'fs'
import { dirname, join } from 'path'
import { parseLogEntryFromStackTrace, stringifyLogEntry } from './log'

// `p` consults this to decide whether to record invocations
// Only this package should mutate this value.
export const ctx = { enabled: false }

export function updateCtx(enabled: boolean) {
  ctx.enabled = enabled
}

// `p` invocations are recorded in a log file to be processed by the watcher
export function getDefaultLogFilePath(): string {
  return join(dirname(__dirname), 'srepl.txt')
}

export function writeStackToLogFile(
  logFilePath: string,
  stack: string,
  value: unknown
) {
  const entry = parseLogEntryFromStackTrace(stack, value)
  if (entry) {
    appendFileSync(logFilePath, `${stringifyLogEntry(logFilePath, entry)}\n`, {
      encoding: 'utf-8',
      flag: 'a',
    })
  }
}
