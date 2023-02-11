#!/usr/bin/env node
import { readFile, unlink, watch, writeFile } from 'fs/promises'
import { join } from 'path'
import { cwd } from 'process'
import { LogEntry, parseLogEntry } from './log'
import { getDefaultLogFilePath, updateCtx } from './tap'
import { SourceMapConsumer } from 'source-map'
import { FileMapper, getErrorMessage, tsExtensions } from './typescript'
import {
  applyLogEntriesToFileContent,
  stripLogEntriesFromFileContent,
  stripTrailingLogComments,
} from './rewrite'

type File = {
  path: string
  content: string
}

type BackLink = {
  sourceFilePath: string
  sourceMapFilePath: string
}

const jsExtensions = ['.js', '.jsx', '.mjs', '.cjs']
const ignoreOwnRewriteDurationMs = 300
const dynamicImport = new Function('specifier', 'return import(specifier)')

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
  const backLinks: Record<string, BackLink> = {}
  let cachedMapper: { mapper: FileMapper | undefined } | undefined

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
          const mapper = (await import('./typescript')).makeTypescriptMapper(
            dir
          )

          if (typeof mapper === 'string') {
            console.error(getErrorMessage(mapper))
            cachedMapper = { mapper: undefined }
          } else {
            cachedMapper = { mapper }
          }
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
      await resetFiles(rewrittenFiles)
    } else {
      throw error
    }
  }
}

async function resetFiles(filePaths: Set<string>) {
  const touchedFiles = Array.from(filePaths)
  const readFiles: (File | undefined)[] = await Promise.all(
    touchedFiles.map(async (path) => {
      let content
      try {
        content = await readFile(path, { encoding: 'utf8' })
      } catch (error) {
        return
      }

      return {
        path,
        content,
      }
    })
  )

  const files: File[] = []
  for (const file of readFiles) {
    if (file) {
      files.push(file)
    }
  }

  const updatedFiles = files.map((f) => ({
    path: f.path,
    content: stripLogEntriesFromFileContent(f.content),
  }))

  await Promise.all(
    updatedFiles.map((f) => writeFile(f.path, f.content, { encoding: 'utf8' }))
  )
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
