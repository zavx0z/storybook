import {randomUUID} from "node:crypto"
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"
import {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
  resolveExternalStorybookDeclarations,
  type ExternalStorybookDeclarationKind,
} from "./declarations.ts"

export const EXTERNAL_STORYBOOK_MANIFEST_SCHEMA_URL =
  "https://raw.githubusercontent.com/zavx0z/storybook/main/schemas/manifest.schema.json"

export const EXTERNAL_STORYBOOK_CATALOG_SCHEMA_URL =
  "https://raw.githubusercontent.com/zavx0z/storybook/main/schemas/catalog.schema.json"

export type InitExternalStorybookDeclarationOptions = Readonly<{
  root: string
  kind: ExternalStorybookDeclarationKind
  label?: string
  executable?: boolean
  stories?: boolean
}>

export type InitializedExternalStorybookDeclaration = Readonly<{
  root: string
  kind: ExternalStorybookDeclarationKind
  directory: string
  manifestPath: string
  catalogPath: string | null
  runtimePath: string | null
  storiesPath: string | null
  referencedDeclarations: readonly string[]
}>

type InitPlan = Readonly<{
  manifest: Readonly<Record<string, unknown>>
  catalog: Readonly<Record<string, unknown>> | null
  runtime: string | null
  stories: boolean
  referencedDeclarations: readonly string[]
}>

const PACKAGE_ID = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const LOCAL_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u

const RUNTIME_STUB = `export const runtime = Object.freeze({
  protocol: "storybook-runtime/1",
  create() {
    return Object.freeze({
      mount() {},
      unmount() {},
      dispose() {},
    })
  },
})
`

/** Creates one declaration boundary without adding a consumer package or lifecycle. */
export async function initExternalStorybookDeclaration(
  options: InitExternalStorybookDeclarationOptions,
): Promise<InitializedExternalStorybookDeclaration> {
  const root = await canonicalDirectory(requiredText("root", options.root))
  const kind = declarationKind(options.kind)
  const executable = optionalBoolean("executable", options.executable)
  const stories = optionalBoolean("stories", options.stories)
  if (kind !== "package" && (executable || stories)) {
    throw new Error(`External Storybook ${kind} init cannot create runtime or stories`)
  }
  const directory = join(root, ".storybook")
  if (await pathExists(directory)) {
    throw new Error(`External Storybook init refuses an existing declaration directory: ${directory}`)
  }

  const plan = kind === "package"
    ? await packagePlan(root, optionalLabel(options.label), executable, stories)
    : await compositionPlan(root, kind, optionalLabel(options.label))
  const staging = join(root, `.storybook-init-${randomUUID()}`)
  await mkdir(staging)
  try {
    await writeJson(join(staging, "manifest.json"), plan.manifest)
    if (plan.catalog !== null) await writeJson(join(staging, "catalog.json"), plan.catalog)
    if (plan.runtime !== null) await writeFile(join(staging, "runtime.ts"), plan.runtime, {flag: "wx"})
    if (plan.stories) await mkdir(join(staging, "stories"))
    await rename(staging, directory)
  } catch (error) {
    await rm(staging, {recursive: true, force: true})
    throw error
  }

  return Object.freeze({
    root,
    kind,
    directory,
    manifestPath: join(directory, "manifest.json"),
    catalogPath: plan.catalog === null ? null : join(directory, "catalog.json"),
    runtimePath: plan.runtime === null ? null : join(directory, "runtime.ts"),
    storiesPath: plan.stories ? join(directory, "stories") : null,
    referencedDeclarations: plan.referencedDeclarations,
  })
}

async function packagePlan(
  root: string,
  requestedLabel: string | null,
  executable: boolean,
  stories: boolean,
): Promise<InitPlan> {
  const packageJsonPath = join(root, "package.json")
  const packageName = await exactPackageName(root, packageJsonPath)
  const label = requestedLabel ?? visibleName(packageName.slice(packageName.indexOf("/") + 1))
  const manifest = {
    $schema: EXTERNAL_STORYBOOK_MANIFEST_SCHEMA_URL,
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    kind: "package",
    id: packageName,
    label,
    packageJson: "../package.json",
    ...await readmeField(root),
    ...(executable
      ? {runtime: {module: "./runtime.ts", export: "runtime"}}
      : {}),
    catalog: "./catalog.json",
  } as const
  const catalog = {
    $schema: EXTERNAL_STORYBOOK_CATALOG_SCHEMA_URL,
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    categories: [{
      id: "package",
      label: "Package",
      subjects: [{
        id: "overview",
        kind: "documentation",
        label,
        apiName: packageName,
        variants: [],
      }],
    }],
  } as const
  return Object.freeze({
    manifest: Object.freeze(manifest),
    catalog: Object.freeze(catalog),
    runtime: executable ? RUNTIME_STUB : null,
    stories,
    referencedDeclarations: Object.freeze([]),
  })
}

async function compositionPlan(
  root: string,
  kind: "project" | "workspace",
  requestedLabel: string | null,
): Promise<InitPlan> {
  const collection = kind === "project" ? "packages" : "projects"
  const expectedChild = kind === "project" ? "package" : "project"
  const manifests = await directDeclarations(root, collection, expectedChild)
  if (manifests.length === 0) {
    throw new Error(
      `External Storybook ${kind} init found no direct ${collection}/* declarations: ${root}`,
    )
  }
  const id = scopeId(basename(root))
  const label = requestedLabel ?? visibleName(basename(root))
  const declarationRoot = join(root, ".storybook")
  const references = Object.freeze(manifests.map((path) => Object.freeze({
    declaration: jsonRelativePath(declarationRoot, path),
  })))
  const manifest = {
    $schema: EXTERNAL_STORYBOOK_MANIFEST_SCHEMA_URL,
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    kind,
    id,
    label,
    ...await readmeField(root),
    ...(kind === "project" ? {packages: references} : {projects: references}),
  }
  return Object.freeze({
    manifest: Object.freeze(manifest),
    catalog: null,
    runtime: null,
    stories: false,
    referencedDeclarations: Object.freeze([...manifests]),
  })
}

async function directDeclarations(
  root: string,
  collection: string,
  expectedKind: "package" | "project",
): Promise<readonly string[]> {
  const directory = join(root, collection)
  let entries
  try {
    entries = await readdir(directory, {withFileTypes: true})
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([])
    throw error
  }
  const manifests: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const lexicalPath = join(directory, entry.name, ".storybook", "manifest.json")
    if (!await pathExists(lexicalPath)) continue
    const canonicalPath = await realpath(lexicalPath)
    if (!isContained(root, canonicalPath)) {
      throw new Error(`External Storybook direct declaration escapes init root: ${lexicalPath}`)
    }
    manifests.push(canonicalPath)
  }
  if (manifests.length === 0) return Object.freeze([])
  const declarations = await resolveExternalStorybookDeclarations(manifests)
  const byId = new Map(declarations.declarations.map((declaration) => [
    declaration.canonicalId,
    declaration,
  ]))
  for (const rootId of declarations.rootIds) {
    const declaration = byId.get(rootId)
    if (declaration?.kind !== expectedKind) {
      throw new Error(
        `External Storybook ${collection}/* declaration must be ${expectedKind}: ${declaration?.manifestPath ?? rootId}`,
      )
    }
  }
  return Object.freeze(manifests)
}

async function exactPackageName(root: string, path: string): Promise<string> {
  let canonical: string
  try {
    canonical = await realpath(path)
  } catch (error) {
    throw new Error(`External Storybook package init requires package.json: ${path}`, {cause: error})
  }
  const metadata = await stat(canonical)
  if (!metadata.isFile() || !isContained(root, canonical)) {
    throw new Error(`External Storybook package.json must be an owner file: ${path}`)
  }
  let value: unknown
  try {
    value = JSON.parse(await readFile(canonical, "utf8"))
  } catch (error) {
    throw new Error(`External Storybook package init requires valid package.json: ${path}`, {cause: error})
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`External Storybook package.json must be an object: ${path}`)
  }
  const name = (value as Record<string, unknown>).name
  if (typeof name !== "string" || !PACKAGE_ID.test(name)) {
    throw new Error(`External Storybook package init requires an exact package name: ${String(name)}`)
  }
  return name
}

async function readmeField(root: string): Promise<Readonly<{readme?: "../README.md"}>> {
  const path = join(root, "README.md")
  if (!await pathExists(path)) return Object.freeze({})
  const canonical = await realpath(path)
  const metadata = await stat(canonical)
  if (!metadata.isFile() || !isContained(root, canonical)) {
    throw new Error(`External Storybook README must be an owner file: ${path}`)
  }
  return Object.freeze({readme: "../README.md"})
}

async function canonicalDirectory(value: string): Promise<string> {
  const root = await realpath(resolve(value))
  const metadata = await stat(root)
  if (!metadata.isDirectory()) throw new Error(`External Storybook init root must be a directory: ${root}`)
  return root
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {flag: "wx"})
}

function jsonRelativePath(from: string, to: string): string {
  const value = relative(from, to).split(sep).join("/")
  if (value.length === 0 || isAbsolute(value)) {
    throw new Error(`External Storybook declaration reference is not relative: ${to}`)
  }
  return value
}

function isContained(root: string, path: string): boolean {
  const value = relative(root, path)
  return value === "" || (!value.startsWith("..") && !isAbsolute(value))
}

function declarationKind(value: unknown): ExternalStorybookDeclarationKind {
  if (value === "package" || value === "project" || value === "workspace") return value
  throw new Error(`Unknown external Storybook declaration kind: ${String(value)}`)
}

function optionalBoolean(label: string, value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value !== "boolean") {
    throw new TypeError(`External Storybook init ${label} must be boolean`)
  }
  return value
}

function optionalLabel(value: unknown): string | null {
  if (value === undefined) return null
  return requiredText("label", value)
}

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`External Storybook init ${label} must be non-empty text`)
  }
  return value
}

function scopeId(value: string): string {
  const id = value.normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .replace(/[._-]{2,}/gu, "-")
  if (!LOCAL_ID.test(id)) throw new Error(`Cannot derive external Storybook scope id: ${value}`)
  return id
}

function visibleName(value: string): string {
  const label = value.replace(/[._-]+/gu, " ").trim()
  if (label.length === 0) throw new Error(`Cannot derive external Storybook label: ${value}`)
  return label[0]!.toUpperCase() + label.slice(1)
}
