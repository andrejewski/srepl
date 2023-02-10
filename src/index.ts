import { ctx, getDefaultLogFilePath, writeStackToLogFile } from './tap'

const logFilePath = getDefaultLogFilePath()

export function p<A>(value: A): A {
  if (ctx.enabled) {
    const stack = new Error().stack
    if (stack) {
      writeStackToLogFile(logFilePath, stack, value)
    }
  }

  return value
}
