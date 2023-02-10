import { relative, resolve } from 'path'
import { inspect } from 'util'

export type LogEntry = {
  filePath: string
  line: number
  column: number | undefined
  result: string
}

const delimiter = ' :: '

export function stringifyLogEntry(
  logFilePath: string,
  entry: LogEntry
): string {
  const { filePath, line, column, result } = entry
  const relativeFilePath = relative(logFilePath, filePath)
  const locationParts =
    column === undefined
      ? [relativeFilePath, line]
      : [relativeFilePath, line, column]
  const location = locationParts.join(':')

  return `${location}${delimiter}${encodeURIComponent(result)}`
}

export function parseLogEntry(
  logFilePath: string,
  log: string
): LogEntry | undefined {
  const delimiterIndex = log.indexOf(delimiter)
  if (delimiterIndex === -1) {
    return
  }

  const location = log.slice(0, delimiterIndex)
  const encodedResult = log.slice(delimiterIndex + delimiter.length)
  const result = decodeURIComponent(encodedResult)

  const loc = parseFileLocationFromString(location)
  if (!loc) {
    return
  }

  const { path: relativeFilePath, line, column } = loc
  const filePath = resolve(logFilePath, relativeFilePath)
  return {
    filePath,
    line,
    column,
    result,
  }
}

const fileUriPrefix = 'file://'
const anonymousCallerFilePrefix = `at ${fileUriPrefix}`

function findLocationInStackTraceLine(line: string): string | undefined {
  if (line.startsWith(anonymousCallerFilePrefix)) {
    return line.slice(anonymousCallerFilePrefix.length)
  }

  if (line.startsWith('at ')) {
    const parenStart = line.indexOf('(')
    if (parenStart !== -1) {
      const filePathStart = parenStart + 1
      const filePathEnd = line.indexOf(')', filePathStart)
      if (filePathEnd !== -1) {
        const uri = line.slice(filePathStart, filePathEnd)
        if (uri.startsWith(fileUriPrefix)) {
          return uri.slice(fileUriPrefix.length)
        }

        return uri
      }
    }
  }

  return
}

type FileLocation = {
  path: string
  line: number
  column: number | undefined
}

function parseFileLocationFromString(
  location: string
): FileLocation | undefined {
  const [rawFilePath, lineStr, columnStr] = location.split(':')
  if (!(rawFilePath && lineStr)) {
    return
  }

  // Remove any cache busting artifacts
  const path = rawFilePath.split('?')[0]!

  const line = parseInt(lineStr, 10)
  if (!isFinite(line)) {
    return
  }

  const column = columnStr ? parseInt(columnStr, 10) : undefined
  if (!(typeof column === 'number' && isFinite(column))) {
    return
  }

  return {
    path,
    line,
    column,
  }
}

export function parseLogEntryFromStackTrace(
  stack: string,
  value: unknown
): LogEntry | undefined {
  const lines = stack.split('\n').slice(1)
  const caller = lines[1]?.trim()
  if (!caller) {
    return
  }

  const location = findLocationInStackTraceLine(caller)
  if (!location) {
    return
  }

  const loc = parseFileLocationFromString(location)
  if (!loc) {
    return
  }

  return {
    filePath: loc.path,
    line: loc.line,
    column: loc.column,
    result: inspect(value),
  }
}
