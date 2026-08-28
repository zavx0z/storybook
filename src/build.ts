/**
Deterministic static delivery for repository-owned Storybook applications.

Every page is bundled in an isolated build. The emitted manifest records only
public paths and immutable identities; checkout paths remain private build
inputs and never leak into the artifact.

@packageDocumentation
*/

import {createHash, randomUUID} from "node:crypto"
import {homedir} from "node:os"
import {basename, dirname, join, parse, resolve, sep} from "node:path"
import {lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from "node:fs/promises"
import {
  defineStorybookApp,
  storybookAppPublicPath,
  storybookPagePublicMount,
  storybookPageRoutes,
  type StorybookAppManifest,
  type StorybookCanvasDescriptor,
  type StorybookCapability,
  type StorybookReadinessDescriptor,
  type StorybookStaticFile,
} from "./app.ts"
import {buildStorybookBrowserPage} from "./internal/browser-build.ts"
import {storybookAppRecoveryIndex} from "./internal/routes.ts"
import {resolveStorybookStaticFiles} from "./internal/static-files.ts"
import {createStorybookPage} from "./server.ts"

export type StorybookRevisionIdentity = Readonly<{
  revision: string
  dirty: boolean
}>

export type StorybookDependencyIdentity = Readonly<{
  name: string
  revision: string
  dirty: boolean
}>

export type StorybookStaticAssetRecord = Readonly<{
  path: string
  bytes: number
  sha256: string
}>

export type StorybookStaticPageRecord = Readonly<{
  id: string
  title: string
  mountPath: string
  publicMountPath: string
  routes: readonly string[]
  capability: StorybookCapability
  touch?: boolean
  readiness: StorybookReadinessDescriptor
  canvas?: StorybookCanvasDescriptor
  entry: string
  chunks: readonly string[]
}>

export type StorybookStaticManifest = Readonly<{
  schemaVersion: 1
  app: Readonly<{
    id: string
    title: string
    basePath: string
  }>
  source: StorybookRevisionIdentity
  dependencies: readonly StorybookDependencyIdentity[]
  pages: readonly StorybookStaticPageRecord[]
  assets: readonly StorybookStaticAssetRecord[]
}>

export type StorybookStaticBuildOptions = Readonly<{
  app: StorybookAppManifest
  outputRoot: string
  source: StorybookRevisionIdentity
  dependencies: readonly StorybookDependencyIdentity[]
  staticFiles: readonly StorybookStaticFile[]
}>

/**
Builds a clean static artifact and its revisioned schema-version-1 manifest.

The artifact is assembled in a sibling staging directory and swaps into an
explicit `dist` only after every bundle, digest and manifest succeeds. An
existing target must contain the previous `storybook-manifest.json` ownership
marker. Dirty identities are recorded rather than rejected, so local evidence
builds remain possible without pretending to be immutable releases.

@param options - A validated application, explicit output directory and exact
source/dependency Git identities.

@returns The same manifest written to `storybook-manifest.json`.

@throws If routing overlaps, identities are not exact Git revisions, a static
file is missing or a browser build fails.
*/
export async function buildStaticStorybook(options: StorybookStaticBuildOptions): Promise<StorybookStaticManifest> {
  const app = defineStorybookApp(options.app)
  storybookAppRecoveryIndex(app)
  const outputRoot = validateOutputRoot(options.outputRoot)
  const source = defineRevisionIdentity(options.source, "source")
  const dependencies = defineDependencies(options.dependencies)
  const staticFiles = resolveStorybookStaticFiles(app, options.staticFiles)

  await assertOwnedOutput(outputRoot, app)
  await mkdir(dirname(outputRoot), {recursive: true})
  const stagingRoot = await mkdtemp(join(dirname(outputRoot), `.${basename(outputRoot)}-storybook-stage-`))
  try {
  const emitted = new Set<string>()
  const emit = async (outputPath: string, data: Blob | Uint8Array | string): Promise<void> => {
    const relativePath = normalizeOutputRelativePath(outputPath)
    if (emitted.has(relativePath)) throw new Error(`Storybook static output collision: ${relativePath}`)
    emitted.add(relativePath)
    const target = join(stagingRoot, ...relativePath.split("/"))
    await mkdir(dirname(target), {recursive: true})
    await Bun.write(target, data)
  }

  const pages: StorybookStaticPageRecord[] = []
  for (const page of app.pages) {
    const assetDirectory = `@storybook-assets/${page.id}`
    const browserBuild = await buildStorybookBrowserPage(page.entrypoint, {
      minify: true,
      sourcemap: "none",
      ...(page.browserBuild === undefined ? {} : {plugins: page.browserBuild.plugins}),
    })
    await emit(`${assetDirectory}/entry.js`, browserBuild.entry)
    const chunkNames = [...browserBuild.chunks.keys()].sort()
    for (const name of chunkNames) {
      const chunk = browserBuild.chunks.get(name)
      if (chunk === undefined) throw new Error(`Storybook browser chunk disappeared during build: ${name}`)
      await emit(`${assetDirectory}/${name}`, chunk)
    }
    await emit(`${assetDirectory}/style.css`, await readFile(page.stylePath))

    const html = await createStorybookPage(app, page).htmlResponse().then((response) => response.text())
    const shellPath = page.mountPath === "/" ? "index.html" : `${page.mountPath.slice(1)}/index.html`
    await emit(shellPath, html)

    pages.push(Object.freeze({
      id: page.id,
      title: page.title,
      mountPath: page.mountPath,
      publicMountPath: storybookPagePublicMount(app, page),
      routes: storybookPageRoutes(app, page),
      capability: page.capability,
      ...(page.touch === true ? {touch: true} : {}),
      readiness: page.readiness,
      ...(page.canvas === undefined ? {} : {canvas: page.canvas}),
      entry: storybookAppPublicPath(app, `/@storybook-assets/${page.id}/entry.js`),
      chunks: Object.freeze(chunkNames.map((name) => storybookAppPublicPath(app, `/@storybook-assets/${page.id}/${name}`))),
    }))
  }

  for (const file of staticFiles) {
    const sourceFile = Bun.file(file.sourcePath)
    if (!await sourceFile.exists()) throw new Error(`Storybook static source does not exist: ${file.sourcePath}`)
    await emit(outputRelativeFromPublicPath(app, file.publicPath), sourceFile)
  }

  await emit(".nojekyll", "")
  await emit("404.html", createNotFoundHtml(app))
  const assets = await collectAssetRecords(app, stagingRoot)
  const manifest = Object.freeze({
    schemaVersion: 1 as const,
    app: Object.freeze({id: app.id, title: app.title, basePath: app.basePath}),
    source,
    dependencies,
    pages: Object.freeze(pages),
    assets,
  }) satisfies StorybookStaticManifest
  await writeFile(join(stagingRoot, "storybook-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  await replaceStaticOutput(stagingRoot, outputRoot, app)
  return manifest
  } catch (error) {
    await rm(stagingRoot, {recursive: true, force: true})
    throw error
  }
}

/**
Reads the immutable HEAD and current dirty bit without changing repository state.

Untracked files participate in `dirty`. The returned value contains no checkout
path, which keeps callers from leaking local realpaths into static manifests.

@param repositoryRoot - Absolute or relative path of the Git working tree.

@throws If the directory is not a readable Git working tree.
*/
export async function readGitIdentity(repositoryRoot: string): Promise<StorybookRevisionIdentity> {
  const revision = await runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"])
  const status = await runGit(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"])
  return defineRevisionIdentity({revision: revision.trim(), dirty: status.length > 0}, "repository")
}

function createNotFoundHtml(app: StorybookAppManifest): string {
  const routes = Object.fromEntries([...storybookAppRecoveryIndex(app)]
    .map(([path, target]) => [path, {
      canonicalPath: target.canonicalPath,
      shellPath: target.shellPath,
    }]))
  const key = `${app.id}-storybook-restore-v1`
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(app.title)} · Страница не найдена</title>
    <script>
      (() => {
        const routes = ${scriptJson(routes)}
        const target = routes[location.pathname]
        if (target === undefined) return
        try {
          sessionStorage.setItem(${scriptJson(key)}, target.canonicalPath + location.search + location.hash)
        } catch {
          return
        }
        location.replace(target.shellPath)
      })()
    </script>
  </head>
  <body><p>Страница Storybook не найдена.</p></body>
</html>`
}

async function collectAssetRecords(
  app: StorybookAppManifest,
  outputRoot: string,
): Promise<readonly StorybookStaticAssetRecord[]> {
  const files = await listOutputFiles(outputRoot)
  const records = await Promise.all(files.map(async (relativePath) => {
    const bytes = await readFile(join(outputRoot, ...relativePath.split("/")))
    return Object.freeze({
      path: storybookAppPublicPath(app, `/${relativePath}`),
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
  }))
  return Object.freeze(records.sort((left, right) => compareText(left.path, right.path)))
}

async function listOutputFiles(root: string, prefix = ""): Promise<string[]> {
  const directory = prefix === "" ? root : join(root, ...prefix.split("/"))
  const entries = await readdir(directory, {withFileTypes: true})
  const files: string[] = []
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...await listOutputFiles(root, path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`Storybook static output contains a non-file entry: ${path}`)
  }
  return files
}

function defineRevisionIdentity(input: StorybookRevisionIdentity, label: string): StorybookRevisionIdentity {
  if (!/^[0-9a-f]{40,64}$/.test(input.revision)) {
    throw new Error(`Storybook ${label} revision must be a full Git object id: ${input.revision}`)
  }
  if (typeof input.dirty !== "boolean") throw new Error(`Storybook ${label} dirty state must be boolean`)
  return Object.freeze({revision: input.revision, dirty: input.dirty})
}

function defineDependencies(input: readonly StorybookDependencyIdentity[]): readonly StorybookDependencyIdentity[] {
  const names = new Set<string>()
  const dependencies = input.map((dependency) => {
    if (!/^@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?$/.test(dependency.name)) {
      throw new Error(`Storybook dependency identity has an invalid name: ${dependency.name}`)
    }
    if (names.has(dependency.name)) throw new Error(`Duplicate Storybook dependency identity: ${dependency.name}`)
    names.add(dependency.name)
    const identity = defineRevisionIdentity(dependency, `dependency ${dependency.name}`)
    return Object.freeze({name: dependency.name, ...identity})
  })
  return Object.freeze(dependencies)
}

function validateOutputRoot(value: string): string {
  const outputRoot = resolve(value)
  if (outputRoot === parse(outputRoot).root || outputRoot === resolve(process.cwd()) || outputRoot === resolve(homedir())) {
    throw new Error(`Refusing to replace broad Storybook output root: ${outputRoot}`)
  }
  if (basename(outputRoot) !== "dist") {
    throw new Error(`Storybook static output root must be an explicit dist directory: ${outputRoot}`)
  }
  return outputRoot
}

async function replaceStaticOutput(
  stagingRoot: string,
  outputRoot: string,
  app: StorybookAppManifest,
): Promise<void> {
  const backupRoot = join(dirname(outputRoot), `.${basename(outputRoot)}-storybook-backup-${randomUUID()}`)
  const hadPrevious = await pathExists(outputRoot)
  await assertOwnedOutput(outputRoot, app)
  if (hadPrevious) await rename(outputRoot, backupRoot)
  try {
    await rename(stagingRoot, outputRoot)
  } catch (error) {
    if (hadPrevious) {
      try {
        await rename(backupRoot, outputRoot)
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], `Storybook static output swap and restore both failed: ${outputRoot}`)
      }
    }
    throw error
  }
  if (hadPrevious) await rm(backupRoot, {recursive: true, force: true})
}

async function assertOwnedOutput(outputRoot: string, app: StorybookAppManifest): Promise<void> {
  if (!await pathExists(outputRoot)) return
  const rootStat = await lstat(outputRoot)
  if (!rootStat.isDirectory()) throw new Error(`Refusing to replace a non-directory Storybook output: ${outputRoot}`)
  const markerPath = join(outputRoot, "storybook-manifest.json")
  let value: unknown
  try {
    value = JSON.parse(await readFile(markerPath, "utf8"))
  } catch (error) {
    throw new Error(`Refusing to replace an unowned dist without a readable Storybook manifest: ${outputRoot}`, {cause: error})
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.app) ||
    value.app.id !== app.id || value.app.basePath !== app.basePath) {
    throw new Error(`Refusing to replace a Storybook dist owned by another app or schema: ${outputRoot}`)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return false
    throw error
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeOutputRelativePath(value: string): string {
  const normalized = value.split(sep).join("/").replace(/^\/+/, "")
  if (normalized.length === 0 || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Storybook output path must stay below outputRoot: ${value}`)
  }
  return normalized
}

function outputRelativeFromPublicPath(app: StorybookAppManifest, publicPath: string): string {
  const prefix = `${app.basePath}/` || "/"
  if (!publicPath.startsWith(prefix)) {
    throw new Error(`Storybook public output is outside the app base: ${publicPath}`)
  }
  return normalizeOutputRelativePath(publicPath.slice(prefix.length))
}

async function runGit(repositoryRoot: string, args: readonly string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`git ${args[0] ?? "command"} failed: ${stderr.trim()}`)
  return stdout
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
