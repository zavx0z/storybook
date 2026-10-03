import Compiler from "@build/compiler"
import Artifacts from "@build/artifacts"
import {readSharedBrowserEpoch} from "./receipt"
import {mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {dirname, join, relative} from "node:path"
import type {SharedBrowserAssets} from "../contract/assets"
import type {SharedBrowserBuildInput, SharedBrowserBuildPhaseListener} from "../contract/build"
import {createHash} from "node:crypto"
import {readWorkbenchStyleSheets} from "./theme"
import Environment from "@build/environment"
import {sources} from "./sources"
import {emittedEntry} from "./emitted-entry"

const {createStorybookPackageCompilerPlugins} = Compiler

/**
Компилирует общую оболочку в принадлежащем её сборке процессе.

Холодная сборка выполняет по одному native проходу kernel и host. При sharedKernel
собирается только host по сохранённой module map; receipt и immutable файлы kernel
должны находиться в root. Namespace каждого результата включает source maps.

@param input - Канонические entrypoints и каталоги результата и staging текущей операции.

@param onPhase - Получатель этапов только этой операции; не запускает отдельный мониторинг.

@returns Готовые артефакты, их адреса и контрольные суммы для атомарной публикации.

@throws Ошибка компиляции, отсутствующего metafile или записи ресурсов.
*/
export async function buildSharedBrowserAssets(input: SharedBrowserBuildInput, onPhase?: SharedBrowserBuildPhaseListener): Promise<SharedBrowserAssets> {
  if (input.sharedKernel !== undefined) {
    const retained = readSharedBrowserEpoch(input.root, input.sharedKernel.epoch, input.sharedKernel.hostModuleEpoch)
    if (!retained?.browserIdentity || JSON.stringify(retained.browserIdentity.modules) !== JSON.stringify(input.sharedKernel.modules)) {
      throw new Error("Retained kernel does not match its saved artifact receipt")
    }
  }
  const packageEntryPath = Environment.exactFile(input.packageEntryPath ?? sources.pageEntry)
  const moduleEntryDirectory = join(realpathSync(dirname(input.root)), ".shared-owner-module-entries")
  try {
  onPhase?.({phase: "resources", state: "started", at: new Date().toISOString()})
  const styles = readWorkbenchStyleSheets(input.toolRoot).map(style => ({...style, bytes: readFileSync(style.path)}))
  const staging = input.stagingDirectory
  rmSync(staging, {recursive: true, force: true})
  mkdirSync(staging, {recursive: true})
  rmSync(moduleEntryDirectory, {recursive: true, force: true})
  let kernelOutputs: Awaited<ReturnType<typeof Bun.build>>["outputs"] = []
  let provisionalIdentity = input.sharedKernel === undefined ? undefined
    : Environment.validate(input.sharedKernel)
  if (provisionalIdentity === undefined) {
    const moduleEntries = Environment.createModuleEntries(
      input.toolRoot,
      moduleEntryDirectory,
    )
    const kernelPlugins = () => createStorybookPackageCompilerPlugins({
      toolRoot: input.toolRoot,
      packageRoot: input.toolRoot,
      repo: input.toolRoot,
      moduleSourcePaths: [],
    })
    onPhase?.({phase: "kernel", state: "started", at: new Date().toISOString()})
    const kernel = await Artifacts.build(async () => ({
      entrypoints: moduleEntries.map(({entryPath}) => entryPath),
      root: moduleEntryDirectory,
      outdir: join(staging, "kernel"),
      naming: {entry: "[dir]/[name]-[hash].[ext]", chunk: "chunks/[name]-[hash].[ext]"},
      target: "browser",
      format: "esm",
      splitting: true,
      sourcemap: "external",
      loader: {".wgsl": "text"},
      plugins: [...await kernelPlugins()],
      metafile: true,
      throw: false,
    }))
    assertSharedBuild(kernel, "kernel")
    onPhase?.({phase: "kernel", state: "completed", at: new Date().toISOString()})
    const kernelEntryFor = (source: string): string => emittedEntry(kernel, staging, source)
    kernelOutputs = kernel.outputs
    provisionalIdentity = Environment.identity(
      "/__storybook/shared/pending-package-entry.js",
      moduleEntries.map(({specifier, sourcePath, entryPath}) => ({specifier, sourcePath,
        url: `/__storybook/shared/${kernelEntryFor(entryPath)}`})),
      "0".repeat(64),
    )
  }
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
  const outputs = [...kernelOutputs, ...host.outputs]
  const artifactDigests = await Promise.all(outputs.map(async artifact => ({
    path: relative(staging, artifact.path),
    digest: createHash("sha256").update(new Uint8Array(await artifact.arrayBuffer())).digest("hex"),
  })))
  artifactDigests.push(...authorStyleSheets.map(style => ({path: style.url, digest: style.contentDigest})))
  Artifacts.publish(input.root, staging, artifactDigests)
  if (input.sharedKernel !== undefined) {
    const retained = readSharedBrowserEpoch(input.root, input.sharedKernel.epoch, input.sharedKernel.hostModuleEpoch)
    if (!retained) throw new Error("Retained kernel artifacts are unavailable")
    artifactDigests.push(...retained.artifactDigests!.filter(artifact => artifact.path.startsWith("kernel/")))
  }
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
    rmSync(moduleEntryDirectory, {recursive: true, force: true})
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
