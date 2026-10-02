import Compiler from "@build/compiler"
import Artifacts from "@build/artifacts"
import {readSharedBrowserEpoch} from "./receipt"
import {mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {basename, dirname, extname, join, relative, resolve, sep} from "node:path"
import PackageInputs from "@package-build/inputs"
import type {SharedBrowserAssets} from "../contract/assets"
import type {SharedBrowserBuildInput, SharedBrowserBuildPhaseListener} from "../contract/build"
import {beginStorybookSharedBuildInputAttestation} from "./plan"
import {createHash} from "node:crypto"
import {readWorkbenchStyleSheets} from "./theme"
import Environment from "@build/environment"
import {sources} from "./sources"

const {createStorybookPackageCompilerPlugins} = Compiler

/**
Компилирует общую оболочку в принадлежащем её сборке процессе.

Холодная сборка выполняет по одному native проходу kernel и host. При sharedKernel
собирается только host по сохранённой module map; receipt и immutable файлы kernel
должны находиться в root. Namespace каждого результата включает source maps.

@param input - Канонические entrypoints и каталоги результата и staging текущей операции.

@param onPhase - Получатель этапов только этой операции; не запускает отдельный мониторинг.

@returns Опубликованные hashed assets и точные зависимости для следующей явной проверки.

@throws Ошибка компиляции, отсутствующего metafile или записи ресурсов.
*/
export async function buildSharedBrowserAssets(input: SharedBrowserBuildInput, onPhase?: SharedBrowserBuildPhaseListener): Promise<SharedBrowserAssets> {
  if (input.sharedKernel !== undefined) {
    const retained = readSharedBrowserEpoch(input.root, input.sharedKernel.epoch)
    if (!retained?.browserIdentity || JSON.stringify(retained.browserIdentity.modules) !== JSON.stringify(input.sharedKernel.modules)) {
      throw new Error("Retained kernel does not match its saved artifact receipt")
    }
  }
  const packageEntryPath = realpathSync(input.packageEntryPath ?? sources.pageEntry)
  onPhase?.({phase: "fingerprint", state: "started", at: new Date().toISOString()})
  const attestation = await beginStorybookSharedBuildInputAttestation({
    ...input,
    packageEntryPath,
    outputDirectory: input.root,
  })
  const moduleEntryDirectory = join(realpathSync(dirname(input.root)), ".shared-owner-module-entries")
  try {
  onPhase?.({phase: "resources", state: "started", at: new Date().toISOString()})
  const styles = await readWorkbenchStyleSheets(input.toolRoot)
  const staging = input.stagingDirectory
  rmSync(staging, {recursive: true, force: true})
  mkdirSync(staging, {recursive: true})
  rmSync(moduleEntryDirectory, {recursive: true, force: true})
  const stagingPrefix = `${realpathSync(staging)}${sep}`
  const moduleEntryPrefix = `${resolve(moduleEntryDirectory)}${sep}`
  let kernelOutputs: Awaited<ReturnType<typeof Bun.build>>["outputs"] = []
  let kernelInputs: Readonly<Record<string, unknown>> = {}
  let provisionalIdentity = input.sharedKernel === undefined ? undefined
    : Environment.validate(input.sharedKernel, false)
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
      outdir: join(staging, "kernel"),
      naming: {entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]"},
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
    const sourceFiles = [...new Set([
      ...PackageInputs.canonicalBuildInputs(kernel.metafile!.inputs, input.toolRoot)
        .filter(path => !path.startsWith(stagingPrefix) && !path.startsWith(moduleEntryPrefix)),
      ...moduleEntries.map(({sourcePath}) => sourcePath),
    ])].sort()
      .map(path => ({
        path,
        contentDigest: createHash("sha256").update(readFileSync(path)).digest("hex"),
      }))
    kernelOutputs = kernel.outputs
    kernelInputs = kernel.metafile!.inputs
    provisionalIdentity = Environment.identity(
      "/__storybook/shared/pending-package-entry.js",
      moduleEntries.map(({specifier, sourcePath, entryPath}) => ({specifier, sourcePath,
        url: `/__storybook/shared/${kernelEntryFor(entryPath)}`})),
      "0".repeat(64), sourceFiles,
    )
  }
  const bootstrapPath = realpathSync(sources.sharedBootstrap)
  const packageHostPath = realpathSync(sources.packageEntry)
  const hostEntryPoints = [...new Set([
    realpathSync(input.landingEntryPath),
    realpathSync(input.fallbackEntryPath),
    packageEntryPath,
    packageHostPath,
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
    naming: {entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]"},
    target: "browser",
    format: "esm",
    splitting: true,
    sourcemap: "external",
    loader: {".wgsl": "text"},
    plugins: [Environment.externalPlugin(provisionalIdentity, input.sharedKernel === undefined), ...await hostPlugins()],
    metafile: true,
    throw: false,
  }))
  if (!host.success) {
    rmSync(staging, {recursive: true, force: true})
    throw new Error(host.logs.map(({message}) => message).join("\n"))
  }
  assertSharedBuild(host, "host")
  onPhase?.({phase: "host", state: "completed", at: new Date().toISOString()})
  const dependencyRealpaths = [...new Set([...PackageInputs.canonicalizeIdentities(
    PackageInputs.canonicalBuildInputs({...kernelInputs, ...host.metafile!.inputs}, input.toolRoot)
      .filter(path => !path.startsWith(stagingPrefix) && !path.startsWith(moduleEntryPrefix)),
  ), ...styles.flatMap(style => [style.path, style.ownerPackageJsonPath])])].sort()
  const landingEntry = emittedEntry(host, staging, input.landingEntryPath)
  const fallbackEntry = emittedEntry(host, staging, input.fallbackEntryPath)
  const packageEntry = emittedEntry(host, staging, packageEntryPath)
  const hostModuleEpoch = buildHostModuleEpoch(host.metafile!.inputs, input.toolRoot, stagingPrefix, attestation.before.toolchainDigest, styles.map(style => style.path))
  const browserIdentity = Environment.identity(
    `/__storybook/shared/${packageEntry}`,
    provisionalIdentity.modules,
    hostModuleEpoch,
    provisionalIdentity.sourceFiles,
    `/__storybook/shared/${emittedEntry(host, staging, packageHostPath)}`,
    input.sharedKernel === undefined,
  )
  onPhase?.({phase: "resources", state: "started", at: new Date().toISOString()})
  const authorStyleSheets = styles.map((style, index) => {
    const bytes = readFileSync(style.path)
    if (createHash("sha256").update(bytes).digest("hex") !== style.contentDigest) throw new Error("Shared author stylesheet changed during build")
    const url = `styles/${index}-${style.contentDigest}.css`
    mkdirSync(dirname(join(staging, url)), {recursive: true})
    writeFileSync(join(staging, url), bytes)
    return {specifier: style.specifier, contentDigest: style.contentDigest, url}
  })
  onPhase?.({phase: "resources", state: "completed", at: new Date().toISOString()})
  onPhase?.({phase: "fingerprint", state: "started", at: new Date().toISOString()})
  const inputFingerprint = await attestation.complete(dependencyRealpaths)
  onPhase?.({phase: "fingerprint", state: "completed", at: new Date().toISOString()})
  onPhase?.({phase: "publish", state: "started", at: new Date().toISOString()})
  const outputs = [...kernelOutputs, ...host.outputs]
  const artifactDigests = await Promise.all(outputs.map(async artifact => ({
    path: relative(staging, artifact.path),
    digest: createHash("sha256").update(new Uint8Array(await artifact.arrayBuffer())).digest("hex"),
  })))
  artifactDigests.push(...authorStyleSheets.map(style => ({path: style.url, digest: style.contentDigest})))
  Artifacts.publish(input.root, staging, artifactDigests)
  if (input.sharedKernel !== undefined) {
    const retained = readSharedBrowserEpoch(input.root, input.sharedKernel.epoch)
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
    dependencyRealpaths,
    inputFingerprint,
    artifactDigests,
    authorStyleSheets,
  })
  } finally {
    attestation.dispose()
    rmSync(input.stagingDirectory, {recursive: true, force: true})
    rmSync(moduleEntryDirectory, {recursive: true, force: true})
  }
}

function assertSharedBuild(result: Bun.BuildOutput, owner: string): void {
  if (!result.success) throw new Error(result.logs.map(({message}) => message).join("\n"))
  if (result.metafile === undefined) throw new Error(`Bun emitted no shared browser ${owner} metafile`)
}

function emittedEntry(result: Bun.BuildOutput, staging: string, source: string): string {
  const name = basename(source, extname(source))
  const byName = result.outputs.find((artifact) =>
    artifact.kind === "entry-point" && basename(artifact.path).startsWith(name))
  if (byName === undefined) throw new Error(`Shared Storybook entry was not emitted: ${source}`)
  return relative(staging, byName.path)
}

/** Хеширует реальные исходники host, включая UI, и компилятор; версия кода одинакова для сохранённых kernel. */
function buildHostModuleEpoch(
  inputs: Readonly<Record<string, unknown>>,
  toolRoot: string,
  stagingPrefix: string,
  toolchainDigest: string,
  styles: readonly string[],
): string {
  const root = realpathSync(toolRoot)
  const paths = [...new Set([...PackageInputs.canonicalBuildInputs(inputs, root), ...styles])].filter(path => !path.startsWith(stagingPrefix)).sort()
  if (paths.length === 0) throw new Error("Shared Storybook host build has no owned source inputs")
  const hash = createHash("sha256").update(toolchainDigest)
  for (const path of paths) {
    hash.update(`${relative(root, path)}\0`)
    hash.update(readFileSync(path))
    hash.update("\0")
  }
  return hash.digest("hex")
}
