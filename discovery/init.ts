import {randomUUID} from "node:crypto"
import {
  lstat,
  mkdir,
  readFile,
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
import type {
  StorybookCatalogScopeKind,
} from "../catalog/catalog.t.ts"
import {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
} from "../catalog/protocol.ts"
import {
  resolveExternalStorybookDeclarations,
} from "./declarations.ts"

export const EXTERNAL_STORYBOOK_MANIFEST_SCHEMA_URL =
  "https://raw.githubusercontent.com/zavx0z/storybook/main/schemas/manifest.schema.json"

export const EXTERNAL_STORYBOOK_CATALOG_SCHEMA_URL =
  "https://raw.githubusercontent.com/zavx0z/storybook/main/schemas/catalog.schema.json"

export type InitExternalStorybookDeclarationOptions = Readonly<{
  root: string
  kind: StorybookCatalogScopeKind
  declarations?: readonly string[]
  executable?: boolean
  stories?: boolean
}>

export type InitializedExternalStorybookDeclaration = Readonly<{
  root: string
  kind: StorybookCatalogScopeKind
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

const RUNTIME_STUB = `type StoryPresentation = Readonly<{
  protocol: "story-presentation/1"
  node: unknown
  componentRoot: Readonly<{readStyleSheets(): unknown}>
  source: Readonly<{html: string; typescript: string}>
  values?: Readonly<Record<string, unknown>>
}>

export const runtime = Object.freeze({
  protocol: "storybook-runtime/4",
  create(context: Readonly<{present(value: StoryPresentation): void}>) {
    return Object.freeze({
      mount(input: Readonly<{story: StoryPresentation}>) {
        context.present(input.story)
      },
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

  await validateRootReadme(root)
  const plan = kind === "package"
    ? await packagePlan(root, executable, stories)
    : await compositionPlan(root, kind, options.declarations ?? [])
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
  executable: boolean,
  stories: boolean,
): Promise<InitPlan> {
  const packageJsonPath = join(root, "package.json")
  const {name: packageName, label} = await exactPackageMetadata(root, packageJsonPath)
  const manifest = {
    $schema: EXTERNAL_STORYBOOK_MANIFEST_SCHEMA_URL,
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    kind: "package",
    id: packageName,
    packageJson: "../package.json",
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
        presentation: {
          protocol: "story-presentation/1",
          projection: "display",
          widgets: ["source", "diagnostics"],
        },
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
  selectedDeclarations: readonly string[],
): Promise<InitPlan> {
  if (kind === "project" && await Bun.file(join(root, "package.json")).exists()) {
    const metadata = await Bun.file(join(root, "package.json")).json()
    if (metadata.workspaces !== undefined) {
      if (selectedDeclarations.length > 0) throw new Error("Structural project init uses workspaces without explicit declarations")
      await resolveExternalStorybookDeclarations([root])
      return Object.freeze({
        manifest: Object.freeze({
          $schema: EXTERNAL_STORYBOOK_MANIFEST_SCHEMA_URL,
          schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
          kind,
          id: metadata.name,
        }),
        catalog: null,
        runtime: null,
        stories: false,
        referencedDeclarations: Object.freeze([]),
      })
    }
  }
  const collection = kind === "project" ? "packages" : "projects"
  const expectedChild = kind === "project" ? "package" : "project"
  const manifests = await explicitDeclarations(root, selectedDeclarations, expectedChild)
  if (manifests.length === 0) {
    throw new Error(
      `External Storybook ${kind} init requires explicit ${collection} declarations: ${root}`,
    )
  }
  const {name: id} = await exactPackageMetadata(root, join(root, "package.json"))
  const declarationRoot = join(root, ".storybook")
  const references = Object.freeze(manifests.map((path) => Object.freeze({
    declaration: jsonRelativePath(declarationRoot, path),
  })))
  const manifest = {
    $schema: EXTERNAL_STORYBOOK_MANIFEST_SCHEMA_URL,
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    kind,
    id,
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

async function explicitDeclarations(
  root: string,
  selected: readonly string[],
  expectedKind: "package" | "project",
): Promise<readonly string[]> {
  const manifests: string[] = []
  for (const input of selected) {
    const path = await realpath(resolve(root, input))
    if (!isContained(root, path)) throw new Error(`External Storybook declaration escapes init root: ${input}`)
    manifests.push(path)
  }
  if (manifests.length === 0) return Object.freeze([])
  const declarations = await resolveExternalStorybookDeclarations(manifests)
  for (const path of manifests) {
    const declaration = declarations.scopes.find(scope => scope.source.path === path)
    if (declaration?.kind !== "package") {
      throw new Error(
        `External Storybook selected declaration must be ${expectedKind}: ${declaration?.source.path ?? path}`,
      )
    }
  }
  return Object.freeze(manifests)
}

async function exactPackageMetadata(root: string, path: string): Promise<Readonly<{name: string; label: string}>> {
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
  const label = requiredText("package.json label", (value as Record<string, unknown>).label)
  if (/[\u0000-\u001f\u007f]/u.test(label)) {
    throw new Error("External Storybook package.json label must not contain control characters")
  }
  return Object.freeze({name, label})
}

async function validateRootReadme(root: string): Promise<void> {
  const path = join(root, "README.md")
  if (!await pathExists(path)) return
  const canonical = await realpath(path)
  const metadata = await stat(canonical)
  if (!metadata.isFile() || !isContained(root, canonical)) {
    throw new Error(`External Storybook README must be an owner file: ${path}`)
  }
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

function declarationKind(value: unknown): StorybookCatalogScopeKind {
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

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`External Storybook init ${label} must be non-empty text`)
  }
  return value
}
