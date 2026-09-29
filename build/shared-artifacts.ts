import {createHash} from "node:crypto"
import {constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync} from "node:fs"
import {dirname, join, relative} from "node:path"

/** SHA-256 реальных байтов; существующий symlink не является immutable артефактом. */
function digest(path: string): string {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`Invalid immutable artifact: ${path}`)
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
Использует штатные naming и splitting Bun. Каждый граф получает пространство
имён, определённое полным первым результатом, независимо от прежних имён Bun.
Так новый граф не переиспользует адреса, уже попавшие в кэш старых browser realms.
Импорты и source maps второй сборки формирует сам Bun, без переписывания JavaScript.
Каждый проход получает собственные plugins: предыдущий compiler session уже закрыт.
*/
export async function buildSharedArtifactGraph(createConfig: () => Promise<Bun.BuildConfig>, staging: string): Promise<Bun.BuildOutput> {
  const config = await createConfig()
  const first = await Bun.build(config)
  if (!first.success) return first
  const artifacts = await Promise.all(first.outputs.map(async artifact => ({
    path: relative(staging, artifact.path),
    digest: createHash("sha256").update(new Uint8Array(await artifact.arrayBuffer())).digest("hex"),
  })))
  const namespace = createHash("sha256").update(JSON.stringify(artifacts.sort((a, b) => a.path.localeCompare(b.path)))).digest("hex")
  if (!config.naming || typeof config.naming === "string") throw new Error("Shared graph requires explicit artifact naming")
  const naming = Object.fromEntries(Object.entries(config.naming).map(([kind, pattern]) => [kind, pattern.replace("/", `/${namespace}/`)]))
  for (const artifact of first.outputs) rmSync(artifact.path, {force: true})
  return Bun.build({...await createConfig(), naming})
}

/** Публикует новые файлы исключительно через create-if-absent; чужие байты не заменяются. */
export function publishSharedArtifacts(
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
