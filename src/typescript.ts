import { dirname, extname, relative, resolve } from 'path'
import {
  sys as tsSys,
  findConfigFile,
  readConfigFile,
  parseJsonConfigFileContent,
} from 'typescript'

type Mapping = {
  outputFilePath: string
  sourceMapFilePath: string
}

export type FileMapper = {
  getOutputFilesForSourceFile(filePath: string): Mapping
}

export const tsExtensions = ['.ts', '.tsx']

type Error =
  | 'tsconfig_not_found'
  | 'no_emit_enabled'
  | 'source_map_disabled'
  | 'multiple_include_directories_not_supported'

export function getErrorMessage(error: Error): string {
  switch (error) {
    case 'tsconfig_not_found':
      return 'Could not find a tsconfig.json'
    case 'no_emit_enabled':
      return 'Compiled JavaScript is required; tsconfig `noEmit` must be unset or false'
    case 'source_map_disabled':
      return 'Source maps are necessary to tie JavaScript execution back to TypeScript source files; tsconfig `sourceMap` must be enabled'
    case 'multiple_include_directories_not_supported':
      return 'Only a single source directory is supported at the moment; tsconfig `include` must have only one source directory'
  }
}

export function makeTypescriptMapper(rootDir: string): FileMapper | Error {
  const tsconfigPath = findConfigFile(
    rootDir,
    tsSys.fileExists,
    'tsconfig.json'
  )
  if (!tsconfigPath) {
    return 'tsconfig_not_found'
  }

  const tsconfigFile = readConfigFile(tsconfigPath, tsSys.readFile)

  const parsedTsconfig = parseJsonConfigFileContent(
    tsconfigFile.config,
    tsSys,
    dirname(tsconfigPath)
  )

  const { include } = tsconfigFile.config
  if (!(Array.isArray(include) && include.length === 1)) {
    return 'multiple_include_directories_not_supported'
  }

  const [srcDir] = include
  const sourceDir = resolve(rootDir, srcDir)

  const { outDir: explicitOutDir } = parsedTsconfig.options
  const outDir = explicitOutDir || (srcDir as string)

  const { noEmit, sourceMap } = parsedTsconfig.options
  if (noEmit) {
    return 'no_emit_enabled'
  }

  if (!sourceMap) {
    return 'source_map_disabled'
  }

  return {
    getOutputFilesForSourceFile(sourceFilePath) {
      const outFile = resolve(outDir, relative(sourceDir, sourceFilePath))
      const ext = extname(sourceFilePath)

      return {
        outputFilePath: outFile.replace(ext, '.js'),
        sourceMapFilePath: outFile.replace(ext, '.js.map'),
      }
    },
  }
}
