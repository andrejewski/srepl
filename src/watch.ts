#!/usr/bin/env node
import { randomUUID } from 'crypto'
import { readFile, unlink, watch, writeFile } from 'fs/promises'
import { join } from 'path'
import { cwd } from 'process'
import { LogEntry, parseLogEntry } from './log'
import { getDefaultLogFilePath, updateCtx } from './tap'
import { SourceMapConsumer } from 'source-map'
import type { FileMapper } from './ts-mapping'

const commentStart = '//=>'
const trailingCommentStart = ` ${commentStart}`

function stripTrailingLogComments(content: string): string {
  return content
    .split('\n')
    .map((l) =>
      l.includes(trailingCommentStart) ? l.split(trailingCommentStart)[0] : l
    )
    .join('\n')
}

const multiLineCommentStart = '/*=>'
const multiLineCommentEnd = '*/\n'

function stripMultiLineLogComments(content: string): string {
  let strippedContent = ''
  for (let i = 0; i < content.length; ) {
    const commentStartIndex = content.indexOf(multiLineCommentStart, i)
    if (commentStartIndex === -1) {
      return strippedContent + content.slice(i)
    }

    const commentEndIndex = content.indexOf(
      multiLineCommentEnd,
      commentStartIndex
    )
    if (commentEndIndex === -1) {
      return strippedContent + content.slice(i)
    }

    strippedContent += content.slice(i, commentStartIndex)
    i = commentEndIndex + multiLineCommentEnd.length
  }

  return strippedContent
}

function stripLogEntriesFromFileContent(content: string): string {
  const c = stripTrailingLogComments(content)
  return stripMultiLineLogComments(c)
}

type Position = {
  line: number
  column: number
}

function findCallEndLineIndex(
  start: Position,
  lines: string[]
): number | undefined {
  const index = start.line - 1
  const line = lines[index]
  if (!line) {
    return
  }

  const parenStartIndex = line.indexOf('(', start.column)
  if (parenStartIndex === -1) {
    // No opening paren found next to function start so
    // we throw out this log entry as it's not a call.
    return
  }

  let searchColumnIndex = parenStartIndex + 1
  let searchLineIndex = index
  if (searchColumnIndex === line.length) {
    searchColumnIndex = 0
    searchLineIndex++
  }

  let parenDepth = 1
  for (let i = searchLineIndex; i < lines.length; i++) {
    const currentLine = lines[i]!
    for (let c = searchColumnIndex; c < currentLine.length; c++) {
      const char = currentLine.charAt(c)
      switch (char) {
        case '(':
          parenDepth++
          break
        case ')':
          parenDepth--
          break
      }

      if (parenDepth === 0) {
        return i
      }
    }

    searchColumnIndex = 0
  }

  return
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((l) => `${prefix}${l}`)
    .join('\n')
}

function backtrackIndent(line: string, caret: number) {
  let indent = ''
  let len = Math.min(caret, line.length)
  for (let i = 0; i < len; i++) {
    if (line.charAt(i) === '\t') {
      indent += '\t'
    } else {
      indent += ' '
    }
  }

  return indent
}

function applyLogEntriesToFileContent(
  content: string,
  entries: LogEntry[]
): string {
  const lineEntries: Record<number, LogEntry[]> = {}
  for (const entry of entries) {
    const list = (lineEntries[entry.line] = lineEntries[entry.line] || [])
    list.push(entry)
  }

  const clearLineMarker = randomUUID()

  const lines = content.split('\n')
  for (const [lineNumber, entries] of Object.entries(lineEntries)) {
    const leftMostColumn = Math.max(
      1,
      Math.min(...entries.map((e) => e.column || Infinity))
    )
    const index = findCallEndLineIndex(
      { line: +lineNumber, column: leftMostColumn },
      lines
    )
    if (index === undefined) {
      continue
    }

    const line = lines[index]
    if (!line) {
      continue
    }

    const originalLine = line.split(trailingCommentStart)[0]
    const multiLineResult = entries.some((e) => e.result.includes('\n'))
    if (multiLineResult) {
      const resultIndent = multiLineCommentStart.length + 1
      let resultIndentation = ''
      for (let i = 0; i < resultIndent; i++) {
        resultIndentation += ' '
      }

      const results = prefixLines(
        entries.map((e) => e.result).join(',\n'),
        resultIndentation
      ).slice(resultIndent)

      const commentIndent = backtrackIndent(line, leftMostColumn - 1)
      lines[index] = `${originalLine}\n${prefixLines(
        `${multiLineCommentStart} ${results}\n*/`,
        commentIndent
      )}`

      const nextLine = lines[index + 1]
      if (nextLine && nextLine.includes(multiLineCommentStart)) {
        lines[index + 1] = clearLineMarker

        for (let i = index + 2; i < lines.length; i++) {
          const commentLine = lines[i]
          lines[i] = clearLineMarker

          if (commentLine && commentLine.includes('*/')) {
            break
          }
        }
      }
    } else {
      lines[index] = `${originalLine}${trailingCommentStart} ${entries
        .map((e) => e.result)
        .join(', ')}`
    }
  }

  return lines.filter((l) => l !== clearLineMarker).join('\n')
}

const ignoreOwnRewriteDurationMs = 300
const dynamicImport = new Function('specifier', 'return import(specifier)')

type File = {
  path: string
  content: string
}

const jsExtensions = ['.js', '.jsx', '.mjs', '.cjs']
const tsExtensions = ['.ts', '.tsx']

type BackLink = {
  sourceFilePath: string
  sourceMapFilePath: string
}

async function run() {
  const logFilePath = getDefaultLogFilePath()
  const dir = cwd()
  const controller = new AbortController()

  process.on('SIGINT', () => {
    controller.abort()
  })

  const watcher = watch(dir, { recursive: true, signal: controller.signal })
  const lastWrites: Record<string, number> = {}
  const rewrittenFiles: Set<string> = new Set([])
  let cachedMapper: { mapper: FileMapper | undefined } | undefined

  const backLinks: Record<string, BackLink> = {}

  try {
    for await (const event of watcher) {
      const eventFilePath = join(dir, event.filename)

      const link = backLinks[eventFilePath]
      let [moduleFilePath, evalFilePath, sourceMapFilePath] = link
        ? [link.sourceFilePath, eventFilePath, link.sourceMapFilePath]
        : [eventFilePath, eventFilePath, undefined]
      delete backLinks[eventFilePath]

      const ts = tsExtensions.some((ext) => moduleFilePath.endsWith(ext))
      if (ts) {
        if (!cachedMapper) {
          const mapper = (await import('./ts-mapping')).makeTypescriptMapper()
          cachedMapper = { mapper: mapper }
        }

        const { mapper } = cachedMapper
        if (!mapper) {
          continue
        }

        const mapping = mapper.getOutputFilesForSourceFile(moduleFilePath)
        const newLink = {
          sourceFilePath: moduleFilePath,
          sourceMapFilePath: mapping.sourceMapFilePath,
        }

        backLinks[mapping.outputFilePath] = newLink
        evalFilePath = mapping.outputFilePath
        sourceMapFilePath = mapping.sourceMapFilePath
      }

      const js = jsExtensions.some((ext) => evalFilePath.endsWith(ext))
      if (!js) {
        continue
      }

      const lastWrittenAt = lastWrites[evalFilePath]
      if (lastWrittenAt) {
        const timeSinceOwnWrite = Date.now() - lastWrittenAt
        if (timeSinceOwnWrite < ignoreOwnRewriteDurationMs) {
          continue
        } else {
          delete lastWrites[evalFilePath]
        }
      }

      await unlink(logFilePath).catch(() => {})

      // ESM modules currently can't be unloaded so we must cache bust
      const cacheBustedModulePath = `${evalFilePath}?cb=${Date.now()}`

      // Require-based files can be cleared from the cache explicitly
      delete require.cache[evalFilePath]

      updateCtx(true)
      try {
        const module = await dynamicImport(cacheBustedModulePath)
        if (module) {
          const { pr } = module
          if (typeof pr === 'function') {
            const result = pr()
            if (result && typeof result.then === 'function') {
              await result
            }
          }
        }
      } catch (error) {
        continue
      } finally {
        updateCtx(false)
      }

      let logContent: string
      try {
        logContent = await readFile(logFilePath, { encoding: 'utf8' })
      } catch (error) {
        continue
      }

      const logLines = logContent.split('\n')
      const logEntries: LogEntry[] = []
      for (const logLine of logLines) {
        const log = parseLogEntry(logFilePath, logLine)
        if (log && log.filePath === evalFilePath) {
          logEntries.push(log)
        }
      }

      if (!logEntries.length) {
        continue
      }

      let mappedLogEntries = logEntries
      if (sourceMapFilePath) {
        const sourceMapContent = await readFile(sourceMapFilePath, {
          encoding: 'utf8',
        })

        const sourceMapData = JSON.parse(sourceMapContent)

        mappedLogEntries = []
        await SourceMapConsumer.with(sourceMapData, null, (consumer) => {
          return logEntries.map((entry) => {
            if (!entry.column) {
              return
            }

            const position = consumer.originalPositionFor({
              line: entry.line,
              column: entry.column,
            })

            const { line, column } = position
            if (!(line !== null && column !== null)) {
              return
            }

            if (entry.filePath !== evalFilePath) {
              return
            }

            const newEntry: LogEntry = {
              filePath: moduleFilePath,
              result: entry.result,
              line: line,
              column: column - 1,
            }

            mappedLogEntries.push(newEntry)
          })
        })
      }

      const moduleContent = await readFile(moduleFilePath, { encoding: 'utf8' })
      const newModuleContent = applyLogEntriesToFileContent(
        stripTrailingLogComments(moduleContent),
        mappedLogEntries
      )

      if (newModuleContent === moduleContent) {
        await unlink(logFilePath).catch(() => {})
        continue
      }

      lastWrites[evalFilePath] = Date.now()
      rewrittenFiles.add(moduleFilePath)
      await Promise.all([
        writeFile(moduleFilePath, newModuleContent, { encoding: 'utf8' }),
        unlink(logFilePath).catch(() => {}),
      ])
    }
  } catch (error) {
    if (controller.signal.aborted) {
      const touchedFiles = Array.from(rewrittenFiles)

      const files: File[] = await Promise.all(
        touchedFiles.map(async (fp) => ({
          path: fp,
          content: await readFile(fp, { encoding: 'utf8' }),
        }))
      )

      const resetFiles = files.map((f) => ({
        path: f.path,
        content: stripLogEntriesFromFileContent(f.content),
      }))

      await Promise.all(
        resetFiles.map((f) =>
          writeFile(f.path, f.content, { encoding: 'utf8' })
        )
      )
    } else {
      throw error
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
