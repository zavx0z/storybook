import Environment from "../index"
import Compiler from "@storybook-tech-build/compiler"
import Artifacts from "@storybook-tech-build/artifacts"
import {createHash} from "node:crypto"
import {lstatSync, mkdirSync, readFileSync, realpathSync, rmSync} from "node:fs"
import {isAbsolute, join, relative} from "node:path"
import type {PlatformArtifacts, PlatformBuildInput, PlatformPhaseListener} from "../contract/build"

/** Подготавливает только общие модули платформы; не импортирует Web, Server или MCP. */
export async function buildPlatform(input: PlatformBuildInput, onPhase?: PlatformPhaseListener): Promise<PlatformArtifacts> {
  const staging = input.stagingDirectory
  const entriesRoot = join(staging, "entries")
  try {
    mkdirSync(staging, {recursive: true})
    const entries = Environment.createModuleEntries(input.toolRoot, entriesRoot)
    onPhase?.({phase: "kernel", state: "started", at: new Date().toISOString()})
    const compiled = await Artifacts.build(async () => ({
      entrypoints: entries.map(entry => entry.entryPath),
      root: entriesRoot,
      outdir: join(staging, "kernel"),
      naming: {entry: "[dir]/[name]-[hash].[ext]", chunk: "chunks/[name]-[hash].[ext]"},
      target: "browser", format: "esm", splitting: true, sourcemap: "external", loader: {".wgsl": "text"},
      plugins: [...await Compiler.createStorybookPackageCompilerPlugins({
        toolRoot: input.toolRoot, packageRoot: input.toolRoot, repo: input.toolRoot, moduleSourcePaths: [],
      })],
      metafile: true, throw: false,
    }))
    if (!compiled.success) throw new Error(compiled.logs.map(log => log.message).join("\n"))
    const identity = Environment.identity("/__storybook/shared/pending-package-entry.js", entries.map(entry => ({
      specifier: entry.specifier, sourcePath: entry.sourcePath,
      url: `/__storybook/shared/${Artifacts.emittedEntry(compiled, staging, entry.entryPath)}`,
    })), "0".repeat(64))
    const artifacts = await Promise.all(compiled.outputs.map(async artifact => ({
      path: relative(staging, artifact.path), digest: createHash("sha256").update(new Uint8Array(await artifact.arrayBuffer())).digest("hex"),
    })))
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
  if (identity.modules.some(module => !paths.has(module.url.slice("/__storybook/shared/".length)))) throw new Error("Платформа ссылается на отсутствующий модуль")
  return Object.freeze({identity, artifacts: Object.freeze(value.artifacts.map(artifact => Object.freeze({...artifact})))})
}
