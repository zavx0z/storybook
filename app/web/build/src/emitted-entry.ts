import {realpathSync} from "node:fs"
import {normalize, relative, resolve, sep} from "node:path"

/**
Находит emitted entry по точному entryPoint native Bun metafile.
Полный output path сохраняет различие одноимённых входов и не выбирает общий chunk.
Artifacts переносит outputs в hash namespace; относительный путь из metafile
сохраняется под этим namespace и сопоставляется с фактическим entry artifact.

@throws При отсутствии metafile, exact source entry либо единственного соответствующего artifact.
*/
export function emittedEntry(result: Bun.BuildOutput, staging: string, source: string): string {
  if (result.metafile === undefined) throw new Error("Bun emitted no shared browser metafile")
  const sourcePath = realpathSync(source)
  const entries = Object.entries(result.metafile.outputs).filter(([, output]) =>
    output.entryPoint !== undefined && realpathSync(resolve(output.entryPoint)) === sourcePath)
  if (entries.length !== 1) throw new Error(`Shared Storybook entry was not uniquely emitted: ${source}`)
  const outputPath = normalize(entries[0]![0])
  const artifacts = result.outputs.filter(artifact => artifact.kind === "entry-point" &&
    (artifact.path === outputPath || artifact.path.endsWith(`${sep}${outputPath}`)))
  if (artifacts.length !== 1) throw new Error(`Shared Storybook entry artifact is missing or ambiguous: ${source}`)
  return relative(staging, artifacts[0]!.path)
}
