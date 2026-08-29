/**
 * Versioned JSON declaration discovery for the external Storybook.
 *
 * The resolver reads data only. It canonicalizes every owner path through
 * `realpath`, rejects paths outside the declaring scope, verifies exact package
 * identity and statically checks requested ESM exports without executing owner
 * modules.
 */

import {createHash} from "node:crypto"
import {realpath, readFile, stat} from "node:fs/promises"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"

export const EXTERNAL_STORYBOOK_SCHEMA_VERSION = 1 as const

export type ExternalStorybookDeclarationKind = "workspace" | "project" | "package"

export type ExternalStorybookPresentationGroup = Readonly<{
  id: string
  label: string
}>

export type ExternalStorybookModuleReference = Readonly<{
  path: string
  exportName: string
}>

export type ExternalStorybookResourceKind =
  | "fixture"
  | "test"
  | "media"
  | "reference"
  | "evidence"
  | "asset"

export type ExternalStorybookResource = Readonly<{
  kind: ExternalStorybookResourceKind
  path: string
}>

export type ResolvedExternalStorybookVariant = Readonly<{
  id: string
  label: string
  group: ExternalStorybookPresentationGroup | null
  route: string
  module: ExternalStorybookModuleReference | null
  resources: readonly ExternalStorybookResource[]
  sourcePointer: string
}>

export type ResolvedExternalStorybookSubject = Readonly<{
  id: string
  route: string
  kind: string
  label: string
  apiName: string | null
  readmePath: string | null
  tags: readonly string[]
  aliases: readonly string[]
  variants: readonly ResolvedExternalStorybookVariant[]
  sourcePointer: string
}>

export type ResolvedExternalStorybookCategory = Readonly<{
  id: string
  route: string
  label: string
  group: ExternalStorybookPresentationGroup | null
  subjects: readonly ResolvedExternalStorybookSubject[]
  sourcePointer: string
}>

export type ResolvedExternalStorybookCatalog = Readonly<{
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  path: string
  digest: string
  categories: readonly ResolvedExternalStorybookCategory[]
}>

type ResolvedExternalStorybookDeclarationBase = Readonly<{
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  canonicalId: string
  id: string
  label: string
  manifestPath: string
  scopeRoot: string
  readmePath: string | null
  digest: string
}>

export type ResolvedExternalStorybookWorkspace = ResolvedExternalStorybookDeclarationBase & Readonly<{
  kind: "workspace"
  projectIds: readonly string[]
}>

export type ResolvedExternalStorybookProject = ResolvedExternalStorybookDeclarationBase & Readonly<{
  kind: "project"
  packageIds: readonly string[]
}>

export type ResolvedExternalStorybookPackage = ResolvedExternalStorybookDeclarationBase & Readonly<{
  kind: "package"
  packageJsonPath: string
  packageName: string
  runtime: ExternalStorybookModuleReference | null
  catalog: ResolvedExternalStorybookCatalog | null
}>

export type ResolvedExternalStorybookDeclaration =
  | ResolvedExternalStorybookWorkspace
  | ResolvedExternalStorybookProject
  | ResolvedExternalStorybookPackage

export type ResolvedExternalStorybookDeclarations = Readonly<{
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  rootIds: readonly string[]
  declarations: readonly ResolvedExternalStorybookDeclaration[]
}>

type ResolveState = {
  declarations: ResolvedExternalStorybookDeclaration[]
  scopeIds: Map<string, string>
  packageJsonOwners: Map<string, string>
  completed: Set<string>
  visiting: string[]
}

const MANIFEST_KEYS = Object.freeze({
  workspace: Object.freeze([
    "$schema",
    "schemaVersion",
    "kind",
    "id",
    "label",
    "readme",
    "projects",
  ]),
  project: Object.freeze([
    "$schema",
    "schemaVersion",
    "kind",
    "id",
    "label",
    "readme",
    "packages",
  ]),
  package: Object.freeze([
    "$schema",
    "schemaVersion",
    "kind",
    "id",
    "label",
    "packageJson",
    "readme",
    "runtime",
    "catalog",
  ]),
} as const)

/**
 * Resolves standalone package, project and workspace roots into one immutable
 * declaration snapshot. The function has no registry side effects: any error
 * rejects the whole candidate subtree.
 */
export async function resolveExternalStorybookDeclarations(
  inputs: readonly string[],
): Promise<ResolvedExternalStorybookDeclarations> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("External Storybook requires at least one declaration or root")
  }
  const state: ResolveState = {
    declarations: [],
    scopeIds: new Map(),
    packageJsonOwners: new Map(),
    completed: new Set(),
    visiting: [],
  }
  const rootIds: string[] = []
  for (const [index, input] of inputs.entries()) {
    const manifestPath = await resolveEntryManifest(visibleText(input, `External Storybook root ${index}`))
    const declaration = await resolveManifest(manifestPath, state)
    rootIds.push(declaration.canonicalId)
  }
  return Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    rootIds: Object.freeze(rootIds),
    declarations: Object.freeze([...state.declarations]),
  })
}

/** Returns the stable canonical declaration identity used by the normalized graph. */
export function externalStorybookDeclarationId(
  kind: ExternalStorybookDeclarationKind,
  id: string,
): string {
  return `${kind}:${id}`
}

async function resolveManifest(
  manifestPath: string,
  state: ResolveState,
): Promise<ResolvedExternalStorybookDeclaration> {
  const cycleIndex = state.visiting.indexOf(manifestPath)
  if (cycleIndex >= 0) {
    const cycle = [...state.visiting.slice(cycleIndex), manifestPath]
    throw new Error(`Cyclic external Storybook declarations:\n${cycle.join("\n")}`)
  }
  if (state.completed.has(manifestPath)) {
    throw new Error(`External Storybook declaration is referenced more than once: ${manifestPath}`)
  }

  const scopeRoot = await manifestScopeRoot(manifestPath)
  const {record, digest} = await readJsonObject(manifestPath, "External Storybook manifest")
  const schemaVersion = record.schemaVersion
  if (schemaVersion !== EXTERNAL_STORYBOOK_SCHEMA_VERSION) {
    throw new Error(`Unsupported external Storybook manifest schemaVersion: ${String(schemaVersion)}`)
  }
  const kindValue = record.kind
  if (kindValue !== "workspace" && kindValue !== "project" && kindValue !== "package") {
    throw new Error(`Unknown external Storybook manifest kind: ${String(kindValue)}`)
  }
  const kind = kindValue
  assertExactKeys(
    record,
    `External Storybook ${kind} manifest`,
    MANIFEST_KEYS[kind],
    kind === "workspace"
      ? ["schemaVersion", "kind", "id", "label", "projects"]
      : kind === "project"
        ? ["schemaVersion", "kind", "id", "label", "packages"]
        : ["schemaVersion", "kind", "id", "label", "packageJson"],
  )
  optionalString(record, "$schema", `External Storybook ${kind} $schema`)
  const id = kind === "package"
    ? packageId(record.id, "External Storybook package id")
    : scopeId(record.id, `External Storybook ${kind} id`)
  const label = visibleText(record.label, `External Storybook ${kind} label`)
  const previousScope = state.scopeIds.get(id)
  if (previousScope !== undefined) {
    const identity = kind === "package" ? "Ambiguous external Storybook package identity" : "Duplicate external Storybook scope id"
    throw new Error(`${identity} ${id}:\n${previousScope}\n${manifestPath}`)
  }
  state.scopeIds.set(id, manifestPath)
  const readmePath = record.readme === undefined
    ? null
    : await resolveContainedFile(
      dirname(manifestPath),
      requiredPath(`${kind} readme`, record.readme),
      scopeRoot,
      `${kind} readme`,
    )
  const canonicalId = externalStorybookDeclarationId(kind, id)

  state.visiting.push(manifestPath)
  try {
    let declaration: ResolvedExternalStorybookDeclaration
    if (kind === "workspace") {
      const references = declarationReferences(record.projects, "workspace projects")
      const projectIds: string[] = []
      for (const [index, reference] of references.entries()) {
        const childPath = await resolveContainedFile(
          dirname(manifestPath),
          reference,
          scopeRoot,
          `workspace project declaration ${index}`,
        )
        const child = await resolveManifest(childPath, state)
        if (child.kind !== "project") {
          throw new Error(`Workspace declaration must reference a project, received ${child.kind}: ${childPath}`)
        }
        projectIds.push(child.canonicalId)
      }
      declaration = Object.freeze({
        schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
        kind,
        canonicalId,
        id,
        label,
        manifestPath,
        scopeRoot,
        readmePath,
        digest,
        projectIds: Object.freeze(projectIds),
      })
    } else if (kind === "project") {
      const references = declarationReferences(record.packages, "project packages")
      const packageIds: string[] = []
      for (const [index, reference] of references.entries()) {
        const childPath = await resolveContainedFile(
          dirname(manifestPath),
          reference,
          scopeRoot,
          `project package declaration ${index}`,
        )
        const child = await resolveManifest(childPath, state)
        if (child.kind !== "package") {
          throw new Error(`Project declaration must reference a package, received ${child.kind}: ${childPath}`)
        }
        packageIds.push(child.canonicalId)
      }
      declaration = Object.freeze({
        schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
        kind,
        canonicalId,
        id,
        label,
        manifestPath,
        scopeRoot,
        readmePath,
        digest,
        packageIds: Object.freeze(packageIds),
      })
    } else {
      const packageJsonPath = await resolveContainedFile(
        dirname(manifestPath),
        requiredPath("package packageJson", record.packageJson),
        scopeRoot,
        "package packageJson",
      )
      if (dirname(packageJsonPath) !== scopeRoot) {
        throw new Error(`External Storybook packageJson must belong to the exact package root: ${packageJsonPath}`)
      }
      const packageName = await readPackageName(packageJsonPath)
      if (packageName !== id) {
        throw new Error(`External Storybook package id ${id} does not match package.json name ${packageName}`)
      }
      const previousPackageOwner = state.packageJsonOwners.get(packageJsonPath)
      if (previousPackageOwner !== undefined) {
        throw new Error(`Ambiguous external Storybook package identity ${id}:\n${previousPackageOwner}\n${manifestPath}`)
      }
      state.packageJsonOwners.set(packageJsonPath, manifestPath)
      const runtime = record.runtime === undefined
        ? null
        : await resolveModuleReference(
          record.runtime,
          dirname(manifestPath),
          scopeRoot,
          "package runtime",
          "module",
        )
      const catalog = record.catalog === undefined
        ? null
        : await resolveCatalog(
          await resolveContainedFile(
            dirname(manifestPath),
            requiredPath("package catalog", record.catalog),
            scopeRoot,
            "package catalog",
          ),
          scopeRoot,
        )
      declaration = Object.freeze({
        schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
        kind,
        canonicalId,
        id,
        label,
        manifestPath,
        scopeRoot,
        readmePath,
        digest,
        packageJsonPath,
        packageName,
        runtime,
        catalog,
      })
    }
    state.completed.add(manifestPath)
    state.declarations.push(declaration)
    return declaration
  } finally {
    const popped = state.visiting.pop()
    if (popped !== manifestPath) throw new Error("External Storybook declaration traversal was corrupted")
  }
}

async function resolveCatalog(
  catalogPath: string,
  scopeRoot: string,
): Promise<ResolvedExternalStorybookCatalog> {
  const {record, digest} = await readJsonObject(catalogPath, "External Storybook catalog")
  assertExactKeys(
    record,
    "External Storybook catalog",
    ["$schema", "schemaVersion", "categories"],
    ["schemaVersion", "categories"],
  )
  optionalString(record, "$schema", "External Storybook catalog $schema")
  if (record.schemaVersion !== EXTERNAL_STORYBOOK_SCHEMA_VERSION) {
    throw new Error(`Unsupported external Storybook catalog schemaVersion: ${String(record.schemaVersion)}`)
  }
  const categoryValues = nonEmptyArray(record.categories, "External Storybook catalog categories")
  const categoryIds = new Set<string>()
  const categoryGroups = new Map<string, string>()
  const categories: ResolvedExternalStorybookCategory[] = []
  for (const [categoryIndex, value] of categoryValues.entries()) {
    const pointer = `/categories/${categoryIndex}`
    const category = objectValue(value, `Catalog ${pointer}`)
    assertExactKeys(category, `Catalog ${pointer}`, ["id", "label", "route", "group", "subjects"], ["id", "label", "subjects"])
    const id = localId(category.id, `Catalog ${pointer} id`)
    assertUnique(categoryIds, id, `Duplicate external Storybook category id: ${id}`)
    const label = visibleText(category.label, `Catalog ${pointer} label`)
    const categoryRoute = category.route === undefined
      ? id
      : routePath(category.route, `Catalog ${pointer} route`)
    const group = optionalGroup(category.group, `Catalog ${pointer} group`, categoryGroups)
    const subjectValues = nonEmptyArray(category.subjects, `Catalog ${pointer} subjects`)
    const subjectIds = new Set<string>()
    const subjects: ResolvedExternalStorybookSubject[] = []
    for (const [subjectIndex, subjectValue] of subjectValues.entries()) {
      const subjectPointer = `${pointer}/subjects/${subjectIndex}`
      const subject = objectValue(subjectValue, `Catalog ${subjectPointer}`)
      assertExactKeys(
        subject,
        `Catalog ${subjectPointer}`,
        ["id", "kind", "label", "route", "apiName", "readme", "tags", "aliases", "variants"],
        ["id", "kind", "label", "variants"],
      )
      const subjectId = localId(subject.id, `Catalog ${subjectPointer} id`)
      assertUnique(subjectIds, subjectId, `Duplicate external Storybook subject id: ${id}/${subjectId}`)
      const subjectKind = localId(subject.kind, `Catalog ${subjectPointer} kind`)
      const subjectLabel = visibleText(subject.label, `Catalog ${subjectPointer} label`)
      const subjectRoute = subject.route === undefined
        ? `${categoryRoute}/${subjectId}`
        : routePath(subject.route, `Catalog ${subjectPointer} route`)
      const apiName = subject.apiName === undefined
        ? null
        : visibleText(subject.apiName, `Catalog ${subjectPointer} apiName`)
      const readmePath = subject.readme === undefined
        ? null
        : await resolveContainedFile(
          dirname(catalogPath),
          requiredPath(`Catalog ${subjectPointer} readme`, subject.readme),
          scopeRoot,
          `Catalog ${subjectPointer} readme`,
        )
      const tags = optionalStringList(subject.tags, `Catalog ${subjectPointer} tags`)
      const aliases = optionalStringList(subject.aliases, `Catalog ${subjectPointer} aliases`)
      const variantValues = arrayValue(subject.variants, `Catalog ${subjectPointer} variants`)
      const variantIds = new Set<string>()
      const variantGroups = new Map<string, string>()
      const variants: ResolvedExternalStorybookVariant[] = []
      for (const [variantIndex, variantValue] of variantValues.entries()) {
        const variantPointer = `${subjectPointer}/variants/${variantIndex}`
        const variant = objectValue(variantValue, `Catalog ${variantPointer}`)
        assertExactKeys(
          variant,
          `Catalog ${variantPointer}`,
          ["id", "label", "group", "route", "module", "resources"],
          ["id", "label"],
        )
        const variantId = localId(variant.id, `Catalog ${variantPointer} id`)
        assertUnique(
          variantIds,
          variantId,
          `Duplicate external Storybook variant id: ${id}/${subjectId}/${variantId}`,
        )
        const variantLabel = visibleText(variant.label, `Catalog ${variantPointer} label`)
        const variantGroup = optionalGroup(
          variant.group,
          `Catalog ${variantPointer} group`,
          variantGroups,
        )
        const route = variant.route === undefined
          ? `${subjectRoute}/${variantId}`
          : routePath(variant.route, `Catalog ${variantPointer} route`)
        const module = variant.module === undefined
          ? null
          : await resolveModuleReference(
            variant.module,
            dirname(catalogPath),
            scopeRoot,
            `Catalog ${variantPointer} module`,
            "path",
          )
        const resources = variant.resources === undefined
          ? Object.freeze([]) as readonly ExternalStorybookResource[]
          : await resolveResources(
            variant.resources,
            dirname(catalogPath),
            scopeRoot,
            `Catalog ${variantPointer} resources`,
          )
        variants.push(Object.freeze({
          id: variantId,
          label: variantLabel,
          group: variantGroup,
          route,
          module,
          resources,
          sourcePointer: variantPointer,
        }))
      }
      subjects.push(Object.freeze({
        id: subjectId,
        route: subjectRoute,
        kind: subjectKind,
        label: subjectLabel,
        apiName,
        readmePath,
        tags,
        aliases,
        variants: Object.freeze(variants),
        sourcePointer: subjectPointer,
      }))
    }
    categories.push(Object.freeze({
      id,
      route: categoryRoute,
      label,
      group,
      subjects: Object.freeze(subjects),
      sourcePointer: pointer,
    }))
  }
  validateCatalogRoutes(categories)
  return Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    path: catalogPath,
    digest,
    categories: Object.freeze(categories),
  })
}

async function resolveResources(
  value: unknown,
  baseDirectory: string,
  scopeRoot: string,
  label: string,
): Promise<readonly ExternalStorybookResource[]> {
  const record = objectValue(value, label)
  const keys = ["fixture", "tests", "media", "references", "evidence", "assets"] as const
  assertExactKeys(record, label, keys, [])
  const output: ExternalStorybookResource[] = []
  const seen = new Set<string>()
  const append = async (kind: ExternalStorybookResourceKind, pathValue: unknown): Promise<void> => {
    const path = await resolveContainedFile(
      baseDirectory,
      requiredPath(`${label} ${kind}`, pathValue),
      scopeRoot,
      `${label} ${kind}`,
    )
    const key = `${kind}\0${path}`
    assertUnique(seen, key, `Duplicate ${label} ${kind}: ${path}`)
    output.push(Object.freeze({kind, path}))
  }
  if (record.fixture !== undefined) await append("fixture", record.fixture)
  for (const [key, kind] of [
    ["tests", "test"],
    ["media", "media"],
    ["references", "reference"],
    ["evidence", "evidence"],
    ["assets", "asset"],
  ] as const) {
    if (record[key] === undefined) continue
    for (const path of arrayValue(record[key], `${label} ${key}`)) await append(kind, path)
  }
  return Object.freeze(output)
}

async function resolveModuleReference(
  value: unknown,
  baseDirectory: string,
  scopeRoot: string,
  label: string,
  pathField: "module" | "path",
): Promise<ExternalStorybookModuleReference> {
  const record = objectValue(value, label)
  assertExactKeys(record, label, [pathField, "export"], [pathField, "export"])
  const modulePath = await resolveContainedFile(
    baseDirectory,
    requiredPath(`${label} path`, record[pathField]),
    scopeRoot,
    `${label} path`,
  )
  const exportName = exportText(record.export, `${label} export`)
  if (!await moduleHasExport(modulePath, exportName, scopeRoot, new Set())) {
    throw new MissingModuleExportError(modulePath, exportName)
  }
  return Object.freeze({path: modulePath, exportName})
}

async function moduleHasExport(
  modulePath: string,
  exportName: string,
  scopeRoot: string,
  visiting: Set<string>,
): Promise<boolean> {
  if (visiting.has(modulePath)) return false
  visiting.add(modulePath)
  const source = await readFile(modulePath, "utf8")
  let scan: ReturnType<Bun.Transpiler["scan"]>
  try {
    scan = new Bun.Transpiler({loader: moduleLoader(modulePath)}).scan(source)
  } catch (error) {
    throw new Error(`Cannot inspect external Storybook module exports: ${modulePath}`, {cause: error})
  }
  if (scan.exports.includes(exportName)) {
    visiting.delete(modulePath)
    return true
  }

  const starReexports = [...source.matchAll(/^\s*export\s*\*\s*from\s*(["'])([^"']+)\1/gmu)]
  for (const match of starReexports) {
    const specifier = match[2]
    if (specifier === undefined || (!specifier.startsWith(".") && !isAbsolute(specifier))) continue
    let resolved: string
    try {
      resolved = await realpath(Bun.resolveSync(specifier, dirname(modulePath)))
    } catch {
      continue
    }
    if (!isContained(scopeRoot, resolved)) continue
    if (await moduleHasExport(resolved, exportName, scopeRoot, visiting)) {
      visiting.delete(modulePath)
      return true
    }
  }
  visiting.delete(modulePath)
  return false
}

class MissingModuleExportError extends Error {
  constructor(modulePath: string, exportName: string) {
    super(`External Storybook module has no export ${exportName}: ${modulePath}`)
    this.name = "MissingModuleExportError"
  }
}

function moduleLoader(path: string): Bun.JavaScriptLoader {
  switch (extname(path).toLowerCase()) {
    case ".jsx": return "jsx"
    case ".tsx": return "tsx"
    case ".js":
    case ".cjs":
    case ".mjs": return "js"
    case ".ts":
    case ".cts":
    case ".mts": return "ts"
    default: throw new Error(`Unsupported external Storybook module extension: ${path}`)
  }
}

function validateCatalogRoutes(categories: readonly ResolvedExternalStorybookCategory[]): void {
  const overviews = new Map<string, string>()
  const leaves = new Map<string, string>()
  for (const category of categories) {
    registerRoute(overviews, category.route, `category ${category.id}`)
    for (const subject of category.subjects) {
      registerRoute(overviews, subject.route, `subject ${category.id}/${subject.id}`)
      for (const variant of subject.variants) {
        registerRoute(
          leaves,
          variant.route,
          `variant ${category.id}/${subject.id}/${variant.id}`,
        )
      }
    }
  }
  for (const [path, owner] of leaves) {
    const overviewOwner = overviews.get(path)
    if (overviewOwner !== undefined) {
      throw new Error(`External Storybook route conflicts with overview ${path}: ${overviewOwner}; ${owner}`)
    }
  }
  const leafPaths = [...leaves.keys()]
  for (const path of leafPaths) {
    for (const other of leafPaths) {
      if (path !== other && other.startsWith(`${path}/`)) {
        throw new Error(`External Storybook leaf route cannot contain another leaf: ${path}; ${other}`)
      }
    }
  }
}

function registerRoute(routes: Map<string, string>, path: string, owner: string): void {
  const previous = routes.get(path)
  if (previous !== undefined) throw new Error(`Duplicate external Storybook route ${path}: ${previous}; ${owner}`)
  routes.set(path, owner)
}

async function resolveEntryManifest(input: string): Promise<string> {
  const absolute = resolve(input)
  let candidate = absolute
  let metadata
  try {
    metadata = await stat(absolute)
  } catch (error) {
    throw new Error(`External Storybook declaration or root does not exist: ${absolute}`, {cause: error})
  }
  if (metadata.isDirectory()) {
    candidate = basename(absolute) === ".storybook"
      ? join(absolute, "manifest.json")
      : join(absolute, ".storybook", "manifest.json")
  }
  return canonicalManifest(candidate)
}

async function canonicalManifest(path: string): Promise<string> {
  let canonical: string
  try {
    canonical = await realpath(path)
  } catch (error) {
    throw new Error(`External Storybook manifest does not exist: ${path}`, {cause: error})
  }
  const metadata = await stat(canonical)
  if (!metadata.isFile()) throw new Error(`External Storybook manifest must be a file: ${canonical}`)
  await manifestScopeRoot(canonical)
  return canonical
}

async function manifestScopeRoot(manifestPath: string): Promise<string> {
  if (basename(manifestPath) !== "manifest.json" || basename(dirname(manifestPath)) !== ".storybook") {
    throw new Error(`External Storybook manifest must be <scope>/.storybook/manifest.json: ${manifestPath}`)
  }
  const scopeRoot = await realpath(join(dirname(manifestPath), ".."))
  if (!isContained(scopeRoot, manifestPath)) {
    throw new Error(`External Storybook manifest escapes its scope root: ${manifestPath}`)
  }
  return scopeRoot
}

async function resolveContainedFile(
  baseDirectory: string,
  value: string,
  scopeRoot: string,
  label: string,
): Promise<string> {
  validateRelativePath(value, label)
  const lexical = resolve(baseDirectory, value)
  if (!isContained(scopeRoot, lexical)) throw new Error(`External Storybook ${label} escapes scope root: ${value}`)
  let canonical: string
  try {
    canonical = await realpath(lexical)
  } catch (error) {
    throw new Error(`External Storybook ${label} does not exist: ${lexical}`, {cause: error})
  }
  if (!isContained(scopeRoot, canonical)) {
    throw new Error(`External Storybook ${label} escapes scope root after realpath: ${value}`)
  }
  const metadata = await stat(canonical)
  if (!metadata.isFile()) throw new Error(`External Storybook ${label} must be a file: ${canonical}`)
  return canonical
}

function isContained(root: string, path: string): boolean {
  const local = relative(root, path)
  return local === "" || (!local.startsWith("..") && !isAbsolute(local))
}

async function readPackageName(packageJsonPath: string): Promise<string> {
  const {record} = await readJsonObject(packageJsonPath, "External Storybook package.json")
  return packageId(record.name, "External Storybook package.json name")
}

async function readJsonObject(
  path: string,
  label: string,
): Promise<Readonly<{record: Record<string, unknown>, digest: string}>> {
  const source = await readFile(path, "utf8")
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`${label} must contain valid JSON: ${path}`, {cause: error})
  }
  return Object.freeze({
    record: objectValue(value, label),
    digest: createHash("sha256").update(source).digest("hex"),
  })
}

function declarationReferences(value: unknown, label: string): readonly string[] {
  const references = nonEmptyArray(value, label)
  return Object.freeze(references.map((candidate, index) => {
    const record = objectValue(candidate, `${label} ${index}`)
    assertExactKeys(record, `${label} ${index}`, ["declaration"], ["declaration"])
    return requiredPath(`${label} ${index} declaration`, record.declaration)
  }))
}

function optionalGroup(
  value: unknown,
  label: string,
  labelsById: Map<string, string>,
): ExternalStorybookPresentationGroup | null {
  if (value === undefined) return null
  const record = objectValue(value, label)
  assertExactKeys(record, label, ["id", "label"], ["id", "label"])
  const id = localId(record.id, `${label} id`)
  const groupLabel = visibleText(record.label, `${label} label`)
  const previous = labelsById.get(id)
  if (previous !== undefined && previous !== groupLabel) {
    throw new Error(`Conflicting external Storybook group label for ${id}: ${previous}; ${groupLabel}`)
  }
  labelsById.set(id, groupLabel)
  return Object.freeze({id, label: groupLabel})
}

function optionalStringList(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([])
  const values = arrayValue(value, label).map((entry, index) => visibleText(entry, `${label} ${index}`))
  if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates`)
  return Object.freeze(values)
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  return value
}

function nonEmptyArray(value: unknown, label: string): unknown[] {
  const result = arrayValue(value, label)
  if (result.length === 0) throw new Error(`${label} must not be empty`)
  return result
}

function assertExactKeys(
  record: Record<string, unknown>,
  label: string,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const accepted = new Set(allowed)
  for (const key of Object.keys(record)) {
    if (!accepted.has(key)) throw new Error(`${label} has unknown field: ${key}`)
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) throw new Error(`${label} is missing field: ${key}`)
  }
}

function optionalString(record: Record<string, unknown>, key: string, label: string): void {
  if (record[key] !== undefined) visibleText(record[key], label)
}

function scopeId(value: unknown, label: string): string {
  const id = visibleText(value, label)
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(id)) throw new Error(`${label} is invalid: ${id}`)
  return id
}

function packageId(value: unknown, label: string): string {
  const id = visibleText(value, label)
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(id)) {
    throw new Error(`${label} must be an exact package name: ${id}`)
  }
  return id
}

function localId(value: unknown, label: string): string {
  const id = visibleText(value, label)
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(id)) throw new Error(`${label} is invalid: ${id}`)
  return id
}

function routePath(value: unknown, label: string): string {
  const path = visibleText(value, label)
  if (path.startsWith("/") || path.endsWith("/") || path.includes("//") ||
    path.includes("\\") || /[?#]/u.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a normalized package-local route: ${path}`)
  }
  return path
}

function exportText(value: unknown, label: string): string {
  const name = visibleText(value, label)
  if (/[\u0000-\u001f\u007f]/u.test(name)) throw new Error(`${label} contains control characters`)
  return name
}

function requiredPath(label: string, value: unknown): string {
  const path = visibleText(value, label)
  validateRelativePath(path, label)
  return path
}

function validateRelativePath(path: string, label: string): void {
  if (isAbsolute(path) || path.includes("\\") || path.includes("\0")) {
    throw new Error(`External Storybook ${label} must be a relative POSIX path: ${path}`)
  }
}

function visibleText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`)
  if (value.trim().length === 0 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must not be empty or contain control characters`)
  }
  return value
}

function assertUnique(values: Set<string>, value: string, message: string): void {
  if (values.has(value)) throw new Error(message)
  values.add(value)
}
