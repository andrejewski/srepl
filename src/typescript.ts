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

export function makeTypescriptMapper(rootDir: string): FileMapper | undefined {
  const tsconfigPath = findConfigFile(
    rootDir,
    tsSys.fileExists,
    'tsconfig.json'
  )
  if (!tsconfigPath) {
    return
  }

  const tsconfigFile = readConfigFile(tsconfigPath, tsSys.readFile)

  const parsedTsconfig = parseJsonConfigFileContent(
    tsconfigFile.config,
    tsSys,
    dirname(tsconfigPath)
  )

  const [src] = tsconfigFile.config.include
  const sourceDir = resolve(rootDir, src)

  const { outDir } = parsedTsconfig.options
  if (!outDir) {
    return
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
