import Compiler from "@storybook-tech-build/compiler"
import Artifacts from "@storybook-tech-build/artifacts"
import {mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {dirname, join, relative} from "node:path"
import type {SharedBrowserAssets} from "../contract/assets"
import type {SharedBrowserBuildInput, SharedBrowserBuildPhaseListener} from "../contract/build"
import {createHash} from "node:crypto"
import {readWorkbenchStyleSheets} from "./theme"
import Environment from "@storybook-tech-build/environment"
import {sources} from "./sources"
const {emittedEntry} = Artifacts

const {createStorybookPackageCompilerPlugins} = Compiler

/**
Компилирует общую оболочку в принадлежащем её сборке процессе.

Готовая платформа обязательна: её модули остаются внешними импортами.
Эта операция никогда не компилирует платформу, сервер, MCP или пакеты проекта.
Namespace результата включает source maps.

@param input - Канонические entrypoints и каталоги результата и staging текущей операции.

@param onPhase - Получатель этапов только этой операции; не запускает отдельный мониторинг.

@returns Готовые артефакты, их адреса и контрольные суммы для атомарной публикации.

@throws Ошибка компиляции, отсутствующего metafile или записи ресурсов.
*/
export async function buildSharedBrowserAssets(input: SharedBrowserBuildInput, onPhase?: SharedBrowserBuildPhaseListener): Promise<SharedBrowserAssets> {
  if (input.sharedKernel === undefined || input.kernelArtifacts === undefined) {
    throw new Error("Сборка Web требует готовую платформу; сначала явно подготовьте среду Storybook")
  }
  const platform = Environment.validateArtifacts(input.root, {identity: input.sharedKernel, artifacts: input.kernelArtifacts})
  const packageEntryPath = Environment.exactFile(input.packageEntryPath ?? sources.pageEntry)
  try {
  onPhase?.({phase: "resources", state: "started", at: new Date().toISOString()})
  const styles = readWorkbenchStyleSheets(input.toolRoot).map(style => ({...style, bytes: readFileSync(style.path)}))
  const staging = input.stagingDirectory
  rmSync(staging, {recursive: true, force: true})
  mkdirSync(staging, {recursive: true})
  const provisionalIdentity = platform.identity
  const bootstrapPath = Environment.exactFile(sources.browserEntry)
  const hostEntryPoints = [...new Set([
    Environment.exactFile(input.landingEntryPath),
    Environment.exactFile(input.fallbackEntryPath),
    packageEntryPath,
    bootstrapPath,
  ])]
  const hostPlugins = () => createStorybookPackageCompilerPlugins({
    toolRoot: input.toolRoot,
    packageRoot: input.toolRoot,
    repo: input.toolRoot,
    moduleSourcePaths: hostEntryPoints,
  })
  onPhase?.({phase: "host", state: "started", at: new Date().toISOString()})
  const host = await Artifacts.build(async () => ({
    entrypoints: hostEntryPoints,
    outdir: join(staging, "host"),
    naming: {entry: "[dir]/[name]-[hash].[ext]"},
    target: "browser",
    format: "esm",
    splitting: false,
    sourcemap: "external",
    loader: {".wgsl": "text"},
    plugins: [Environment.externalPlugin(provisionalIdentity), ...await hostPlugins()],
    metafile: true,
    throw: false,
  }))
  if (!host.success) {
    rmSync(staging, {recursive: true, force: true})
    throw new Error(host.logs.map(({message}) => message).join("\n"))
  }
  assertSharedBuild(host, "host")
  onPhase?.({phase: "host", state: "completed", at: new Date().toISOString()})
  const landingEntry = emittedEntry(host, staging, input.landingEntryPath)
  const fallbackEntry = emittedEntry(host, staging, input.fallbackEntryPath)
  const packageEntry = emittedEntry(host, staging, packageEntryPath)
  const hostModuleEpoch = await buildHostModuleEpoch(host.outputs, staging, styles.map(style => style.bytes))
  const browserIdentity = Environment.identity(
    `/__storybook/shared/${packageEntry}`,
    provisionalIdentity.modules,
    hostModuleEpoch,
  )
  onPhase?.({phase: "resources", state: "started", at: new Date().toISOString()})
  const authorStyleSheets = styles.map((style, index) => {
    const bytes = style.bytes
    const contentDigest = createHash("sha256").update(bytes).digest("hex")
    const url = `styles/${index}-${contentDigest}.css`
    mkdirSync(dirname(join(staging, url)), {recursive: true})
    writeFileSync(join(staging, url), bytes)
    return {specifier: style.specifier, contentDigest, url}
  })
  onPhase?.({phase: "resources", state: "completed", at: new Date().toISOString()})
  onPhase?.({phase: "publish", state: "started", at: new Date().toISOString()})
  const outputs = host.outputs
  const artifactDigests = await Promise.all(outputs.map(async artifact => ({
    path: relative(staging, artifact.path),
    digest: createHash("sha256").update(new Uint8Array(await artifact.arrayBuffer())).digest("hex"),
  })))
  artifactDigests.push(...authorStyleSheets.map(style => ({path: style.url, digest: style.contentDigest})))
  Artifacts.publish(input.root, staging, artifactDigests)
  artifactDigests.push(...platform.artifacts)
  rmSync(staging, {recursive: true, force: true})
  return Object.freeze({
    root: input.root,
    landingEntry,
    fallbackEntry,
    bootstrapEntry: emittedEntry(host, staging, bootstrapPath),
    browserIdentity,
    artifactDigests,
    authorStyleSheets,
  })
  } finally {
    rmSync(input.stagingDirectory, {recursive: true, force: true})
  }
}

function assertSharedBuild(result: Bun.BuildOutput, owner: string): void {
  if (!result.success) throw new Error(result.logs.map(({message}) => message).join("\n"))
  if (result.metafile === undefined) throw new Error(`Bun emitted no shared browser ${owner} metafile`)
}

/** Адресует готовый Web по выпущенным файлам, не перечитывая исходники после компиляции. */
async function buildHostModuleEpoch(
  outputs: readonly Bun.BuildArtifact[],
  staging: string,
  styles: readonly Uint8Array[],
): Promise<string> {
  const hash = createHash("sha256")
  for (const output of [...outputs].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${relative(staging, output.path)}\0`)
    hash.update(new Uint8Array(await output.arrayBuffer()))
  }
  for (const bytes of styles) hash.update(bytes)
  return hash.digest("hex")
}
