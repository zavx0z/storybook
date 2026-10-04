/**
Компилирует связанный граф и публикует неизменяемые артефакты по реальным байтам.
Не знает предметных пакетов, Web и маршрутов приложения.

@packageDocumentation
*/
import {emittedEntry} from "./src/emitted-entry"
import {createHash} from "node:crypto"
import {constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync} from "node:fs"
import {dirname, join, relative, resolve} from "node:path"
import type {StorybookTechBuildArtifacts} from "./contract"

export type {StorybookTechBuildArtifacts} from "./contract"

/** SHA-256 реальных байтов; существующий symlink не является immutable артефактом. */
function digest(path: string): string {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`Invalid immutable artifact: ${path}`)
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
Компилирует граф одним Bun.build с его штатными относительными ссылками.
Готовый каталог переносится под SHA-256 всех outputs, включая source maps:
обычный Bun hash не меняется при правке комментария, а source map меняется.
Байты не переписываются; прежние browser URLs сохраняют свои файлы.

Временный и окончательный каталог являются соседями, поэтому относительные
импорты, source maps и пути их исходников сохраняют смысл после переноса.
Одинаковый результат получает тот же namespace независимо от staging операции.
*/
async function buildSharedArtifactGraph(createConfig: () => Promise<Bun.BuildConfig>): Promise<Bun.BuildOutput> {
  const config = await createConfig()
  if (!config.outdir || config.publicPath) throw new Error("Shared graph requires an output directory and relative artifact links")
  const directory = resolve(config.outdir)
  const pending = join(directory, ".pending")
  const result = await Bun.build({...config, outdir: pending})
  if (!result.success) return result
  const artifacts = await Promise.all(result.outputs.map(async artifact => ({
    path: relative(pending, artifact.path),
    digest: createHash("sha256").update(new Uint8Array(await artifact.arrayBuffer())).digest("hex"),
  })))
  const namespace = createHash("sha256").update(JSON.stringify(artifacts.sort((a, b) => a.path.localeCompare(b.path)))).digest("hex")
  const destination = join(directory, namespace)
  renameSync(pending, destination)
  const relocated = new Map(result.outputs.map(artifact => [artifact, Object.assign(
    Bun.file(join(destination, relative(pending, artifact.path)), {type: artifact.type}),
    {
      path: join(destination, relative(pending, artifact.path)),
      loader: artifact.loader,
      hash: artifact.hash,
      kind: artifact.kind,
      sourcemap: null as Bun.BuildArtifact | null,
    },
  )]))
  const maps = new Map([...relocated.values()]
    .filter(output => output.kind === "sourcemap")
    .map(output => [output.path, output]))
  // При splitting Bun может вернуть в sourcemap соседний JS; связь задаёт фактический map output.
  for (const [artifact, output] of relocated) {
    output.sourcemap = maps.get(`${output.path}.map`) ??
      (artifact.sourcemap?.kind === "sourcemap" ? relocated.get(artifact.sourcemap) ?? null : null)
  }
  return {...result, outputs: [...relocated.values()]}
}

/** Публикует новые файлы исключительно через create-if-absent; чужие байты не заменяются. */
function publishSharedArtifacts(
  root: string,
  staging: string,
  artifacts: readonly Readonly<{path: string; digest: string}>[],
): void {
  for (const artifact of artifacts) {
    if (digest(join(staging, artifact.path)) !== artifact.digest) throw new Error(`Shared artifact changed before publication: ${artifact.path}`)
    const target = join(root, artifact.path)
    if (existsSync(target) && digest(target) !== artifact.digest) throw new Error(`Immutable shared artifact collision: ${artifact.path}`)
  }
  for (const artifact of artifacts) {
    const target = join(root, artifact.path)
    mkdirSync(dirname(target), {recursive: true})
    try {
      copyFileSync(join(staging, artifact.path), target, constants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || digest(target) !== artifact.digest) throw error
    }
  }
}

/** Сборка и публикация используют одну проверку целостности результатов. */
const artifacts: StorybookTechBuildArtifacts.Output = Object.freeze({
  emittedEntry,
  build: buildSharedArtifactGraph,
  publish: publishSharedArtifacts,
})

export default artifacts
