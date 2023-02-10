import { randomUUID } from 'crypto'
import type { LogEntry } from './log'

const commentStart = '//=>'
const trailingCommentStart = ` ${commentStart}`

export function stripTrailingLogComments(content: string): string {
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

export function stripLogEntriesFromFileContent(content: string): string {
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

export function applyLogEntriesToFileContent(
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
