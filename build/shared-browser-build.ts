import {mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs"
import {basename, dirname, extname, join, relative, sep} from "node:path"
import {fileURLToPath} from "node:url"
import {canonicalBuildInputs, canonicalizeStorybookPackageIdentities} from "./package-build.ts"
import {createStorybookPackageCompilerPlugins} from "./compiler.ts"
import type {SharedBrowserAssets} from "./shared-browser-assets.ts"
import type {SharedBrowserBuildInput} from "./types/shared-browser.ts"
import {beginStorybookSharedBuildInputAttestation} from "./build-input-fingerprint.ts"
import {createHash} from "node:crypto"
import type {StorybookBuildPhaseListener} from "./build-phase.ts"
import {resolveExternalStorybookAuthorStyleSheets} from "../discovery/declarations.ts"
import {
  createStorybookSharedBrowserExternalPlugin,
  createStorybookSharedBrowserModuleEntries,
  storybookSharedBrowserIdentity,
} from "./shared-module-identity.ts"

/**
Компилирует общую оболочку в принадлежащем её сборке процессе.

@param input - Канонические entrypoints и каталоги результата и staging текущей операции.

@param onPhase - Получатель этапов только этой операции; не запускает отдельный мониторинг.

@returns Опубликованные hashed assets и точные зависимости для watcher.

@throws Ошибка компиляции, отсутствующего metafile или записи ресурсов.
*/
export async function buildSharedBrowserAssets(input: SharedBrowserBuildInput, onPhase?: StorybookBuildPhaseListener): Promise<SharedBrowserAssets> {
  const packageEntryPath = realpathSync(input.packageEntryPath ?? fileURLToPath(
    new URL("../runtime/page-entry.ts", import.meta.url),
  ))
  onPhase?.({phase: "fingerprint", state: "started", at: new Date().toISOString()})
  const attestation = await beginStorybookSharedBuildInputAttestation({
    ...input,
    packageEntryPath,
    outputDirectory: input.root,
  })
  const moduleEntryDirectory = join(dirname(input.root), ".shared-owner-module-entries")
  try {
  onPhase?.({phase: "resources", state: "started", at: new Date().toISOString()})
  const styles = await resolveExternalStorybookAuthorStyleSheets(input.toolRoot)
  const staging = input.stagingDirectory
  rmSync(staging, {recursive: true, force: true})
  mkdirSync(staging, {recursive: true})
  rmSync(moduleEntryDirectory, {recursive: true, force: true})
  const moduleEntries = createStorybookSharedBrowserModuleEntries(
    input.toolRoot,
    moduleEntryDirectory,
  )
  const kernelPlugins = await createStorybookPackageCompilerPlugins({
    packageRoot: input.toolRoot,
    projectRoot: input.toolRoot,
    moduleSourcePaths: [],
  })
  onPhase?.({phase: "kernel", state: "started", at: new Date().toISOString()})
  const kernel = await Bun.build({
    entrypoints: moduleEntries.map(({entryPath}) => entryPath),
    outdir: staging,
    naming: {entry: "kernel/[name]-[hash].[ext]", chunk: "kernel/chunks/[name]-[hash].[ext]"},
    publicPath: "/__storybook/shared/",
    target: "browser",
    format: "esm",
    splitting: true,
    sourcemap: "external",
    loader: {".wgsl": "text"},
    plugins: [...kernelPlugins],
    metafile: true,
    throw: false,
  })
  assertSharedBuild(kernel, "kernel")
  onPhase?.({phase: "kernel", state: "completed", at: new Date().toISOString()})
  const kernelEntryFor = (source: string): string => emittedEntry(kernel, staging, source)
  const stagingPrefix = `${realpathSync(staging)}${sep}`
  const moduleEntryPrefix = `${realpathSync(moduleEntryDirectory)}${sep}`
  const kernelSourceFiles = [...new Set([
    ...canonicalBuildInputs(kernel.metafile!.inputs, input.toolRoot)
      .filter(path => !path.startsWith(stagingPrefix) && !path.startsWith(moduleEntryPrefix)),
    ...moduleEntries.map(({sourcePath}) => sourcePath),
  ])].sort()
    .map(path => ({
      path,
      contentDigest: createHash("sha256").update(readFileSync(path)).digest("hex"),
    }))
  const provisionalIdentity = storybookSharedBrowserIdentity(
    "/__storybook/shared/pending-package-entry.js",
    moduleEntries.map(({specifier, sourcePath, entryPath}) => ({
      specifier,
      sourcePath,
      url: `/__storybook/shared/${kernelEntryFor(entryPath)}`,
    })),
    "0".repeat(64),
    kernelSourceFiles,
  )
  const packageHostPath = realpathSync(fileURLToPath(new URL("../runtime/package-entry.ts", import.meta.url)))
  const hostEntryPoints = [...new Set([
    realpathSync(input.landingEntryPath),
    realpathSync(input.fallbackEntryPath),
    packageEntryPath,
    packageHostPath,
  ])]
  const hostPlugins = await createStorybookPackageCompilerPlugins({
    packageRoot: input.toolRoot,
    projectRoot: input.toolRoot,
    moduleSourcePaths: hostEntryPoints,
  })
  onPhase?.({phase: "host", state: "started", at: new Date().toISOString()})
  const host = await Bun.build({
    entrypoints: hostEntryPoints,
    outdir: staging,
    naming: {entry: "entries/[name]-[hash].[ext]", chunk: "chunks/[name]-[hash].[ext]"},
    publicPath: "/__storybook/shared/",
    target: "browser",
    format: "esm",
    splitting: true,
    sourcemap: "external",
    loader: {".wgsl": "text"},
    plugins: [createStorybookSharedBrowserExternalPlugin(provisionalIdentity), ...hostPlugins],
    metafile: true,
    throw: false,
  })
  if (!host.success) {
    rmSync(staging, {recursive: true, force: true})
    throw new Error(host.logs.map(({message}) => message).join("\n"))
  }
  assertSharedBuild(host, "host")
  onPhase?.({phase: "host", state: "completed", at: new Date().toISOString()})
  const dependencyRealpaths = [...new Set([...canonicalizeStorybookPackageIdentities(
    canonicalBuildInputs({...kernel.metafile!.inputs, ...host.metafile!.inputs}, input.toolRoot)
      .filter(path => !path.startsWith(stagingPrefix) && !path.startsWith(moduleEntryPrefix)),
  ), ...styles.flatMap(style => [style.path, style.ownerPackageJsonPath])])].sort()
  const landingEntry = emittedEntry(host, staging, input.landingEntryPath)
  const fallbackEntry = emittedEntry(host, staging, input.fallbackEntryPath)
  const packageEntry = emittedEntry(host, staging, packageEntryPath)
  const hostModuleEpoch = buildHostModuleEpoch(host.metafile!.inputs, input.toolRoot, stagingPrefix)
  const browserIdentity = storybookSharedBrowserIdentity(
    `/__storybook/shared/${packageEntry}`,
    moduleEntries.map(({specifier, sourcePath, entryPath}) => ({
      specifier,
      sourcePath,
      url: `/__storybook/shared/${kernelEntryFor(entryPath)}`,
    })),
    hostModuleEpoch,
    kernelSourceFiles,
    `/__storybook/shared/${emittedEntry(host, staging, packageHostPath)}`,
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
  const outputs = [...kernel.outputs, ...host.outputs]
  const artifactDigests = await Promise.all(outputs.map(async artifact => ({
    path: relative(staging, artifact.path),
    digest: createHash("sha256").update(new Uint8Array(await artifact.arrayBuffer())).digest("hex"),
  })))
  artifactDigests.push(...authorStyleSheets.map(style => ({path: style.url, digest: style.contentDigest})))
  // Hashed assets stay available to documents that still reference older entries.
  for (const artifact of artifactDigests) {
    const destination = join(input.root, artifact.path)
    mkdirSync(dirname(destination), {recursive: true})
    renameSync(join(staging, artifact.path), destination)
  }
  rmSync(staging, {recursive: true, force: true})
  return Object.freeze({
    root: input.root,
    landingEntry,
    fallbackEntry,
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

/** Хеширует только реально использованные исходники host, принадлежащие Storybook checkout. */
function buildHostModuleEpoch(
  inputs: Readonly<Record<string, unknown>>,
  toolRoot: string,
  stagingPrefix: string,
): string {
  const root = realpathSync(toolRoot)
  const rootPrefix = `${root}${sep}`
  const dependencyPrefix = `${join(root, "node_modules")}${sep}`
  const paths = canonicalBuildInputs(inputs, root).filter(path =>
    path.startsWith(rootPrefix) && !path.startsWith(dependencyPrefix) && !path.startsWith(stagingPrefix))
  if (paths.length === 0) throw new Error("Shared Storybook host build has no owned source inputs")
  const hash = createHash("sha256")
  for (const path of paths) {
    hash.update(`${relative(root, path)}\0`)
    hash.update(readFileSync(path))
    hash.update("\0")
  }
  return hash.digest("hex")
}
