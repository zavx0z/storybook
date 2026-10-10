import Environment from "../index"
import Artifacts from "@zavx0z/storybook-tech-build-artifacts"
import {createHash} from "node:crypto"
import {copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync} from "node:fs"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import type {PlatformArtifacts, PlatformBuildInput, PlatformPhaseListener} from "../contract/build"

/** Публикует готовые ESM Immersive и их chunks, сохраняя существующую доставку Storybook. */
export async function buildPlatform(input: PlatformBuildInput, onPhase?: PlatformPhaseListener): Promise<PlatformArtifacts> {
  const staging = input.stagingDirectory
  try {
    mkdirSync(staging, {recursive: true})
    const entries = Environment.createModuleEntries(input.toolRoot)
    onPhase?.({phase: "kernel", state: "started", at: new Date().toISOString()})
    const manifestPath = Bun.resolveSync("@zavx0z/immersive/browser.json", input.toolRoot)
    const readyRoot = realpathSync(dirname(manifestPath))
    const ready = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      schemaVersion: number; name: string; entries: Record<string, string>
      files: {path: string; digest: string}[]
      sourceExports?: Record<string, {specifier: string; source: string; manifest: string; digest: string; file: string}[]>
    }
    if (ready.schemaVersion !== 1 || ready.name !== "@zavx0z/immersive" || !Array.isArray(ready.files) ||
      ready.files.length === 0 || !ready.entries || typeof ready.entries !== "object") {
      throw new Error("Immersive browser.json не содержит готовую поставку")
    }
    const files = new Map<string, {source: string; digest: string}>()
    for (const file of ready.files) {
      if (typeof file.path !== "string" || file.path.includes("\\") || file.path.split("/").some(part => !part || part === ".." || part === ".") ||
        isAbsolute(file.path) || !/^[a-f0-9]{64}$/u.test(file.digest) || files.has(file.path)) throw new Error("Недопустимый файл Immersive")
      const lexical = resolve(readyRoot, file.path)
      const info = lstatSync(lexical)
      const source = realpathSync(lexical)
      if (!info.isFile() || info.isSymbolicLink() || !source.startsWith(`${readyRoot}${sep}`) ||
        createHash("sha256").update(readFileSync(source)).digest("hex") !== file.digest) throw new Error(`Повреждён файл Immersive: ${file.path}`)
      files.set(file.path, {source, digest: file.digest})
    }
    const revision = createHash("sha256").update(JSON.stringify(ready)).digest("hex")
    const directory = `kernel/${revision}`
    const identity = Environment.identity("/__storybook/shared/pending-package-entry.js", entries.map(entry => ({
      specifier: entry.specifier, sourcePath: entry.sourcePath,
      url: `/__storybook/shared/${directory}/${publicEntry(entry.specifier, entry.sourcePath)}`,
      sources: (ready.sourceExports?.[entry.specifier] ?? []).map(source => {
        if (typeof source.specifier !== "string" || !/^[a-f0-9]{64}$/u.test(source.digest) || !files.has(source.file)) {
          throw new Error("Недопустимое происхождение входа Immersive")
        }
        return {specifier: source.specifier, sourcePath: ownerPath(source.source), manifestPath: ownerPath(source.manifest),
          manifestDigest: source.digest, url: `/__storybook/shared/${directory}/${source.file}`}
      }),
    })), "0".repeat(64))
    function publicEntry(specifier: string, source: string): string {
      const path = ready.entries[specifier]
      if (!path || files.get(path)?.source !== source) throw new Error(`Готовая поставка не содержит ${specifier}`)
      return path
    }
    function ownerPath(path: string): string {
      if (typeof path !== "string" || path.includes("\\") || isAbsolute(path) || path.split("/").some(part => !part || part === "." || part === "..")) {
        throw new Error("Недопустимый адрес исходного владельца Immersive")
      }
      return resolve(readyRoot, "..", path)
    }
    const artifacts = [...files].map(([path, file]) => {
      const destination = join(staging, directory, path)
      mkdirSync(dirname(destination), {recursive: true})
      copyFileSync(file.source, destination)
      return {path: `${directory}/${path}`, digest: file.digest}
    })
    Artifacts.publish(input.root, staging, artifacts)
    onPhase?.({phase: "kernel", state: "completed", at: new Date().toISOString()})
    return validatePlatformArtifacts(input.root, {identity, artifacts})
  } finally { rmSync(staging, {recursive: true, force: true}) }
}

/** Проверяет готовый набор, включая chunks; исходники платформы не читаются. */
export function validatePlatformArtifacts(root: string, value: PlatformArtifacts): PlatformArtifacts {
  const identity = Environment.validate(value.identity)
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) throw new Error("Готовые файлы платформы отсутствуют")
  const canonicalRoot = realpathSync(root)
  const paths = new Set<string>()
  for (const artifact of value.artifacts) {
    if (typeof artifact.path !== "string" || !artifact.path.startsWith("kernel/") || paths.has(artifact.path) ||
      !/^[a-f0-9]{64}$/u.test(artifact.digest)) throw new Error("Недопустимый артефакт платформы")
    const lexical = join(canonicalRoot, artifact.path)
    const info = lstatSync(lexical)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Артефакт платформы должен быть обычным файлом")
    const path = realpathSync(lexical)
    const local = relative(canonicalRoot, path)
    if (!local || local.startsWith("..") || isAbsolute(local)) throw new Error("Артефакт платформы вышел за пределы своего каталога")
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== artifact.digest) throw new Error(`Повреждён артефакт платформы: ${artifact.path}`)
    paths.add(artifact.path)
  }
  if (identity.modules.some(module => [module.url, ...(module.sources ?? []).map(source => source.url)]
    .some(url => !paths.has(url.slice("/__storybook/shared/".length))))) throw new Error("Платформа ссылается на отсутствующий модуль")
  return Object.freeze({identity, artifacts: Object.freeze(value.artifacts.map(artifact => Object.freeze({...artifact})))})
}
