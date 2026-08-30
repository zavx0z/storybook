/**
 * Versioned JSON declaration discovery for the external Storybook.
 *
 * The resolver reads data only. It canonicalizes every owner path through
 * `realpath`, rejects paths outside the declaring scope, verifies exact package
 * identity and statically checks requested ESM exports without executing owner
 * modules.
 */

import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {open, realpath, readFile, stat} from "node:fs/promises"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
import {
  validateExternalStorybookExportName,
  validateExternalStorybookModulePath,
  validateExternalStorybookPackageId,
  validateExternalStorybookRoute,
  validateExternalStorybookScopeId,
} from "./declaration-law.ts"

export const EXTERNAL_STORYBOOK_SCHEMA_VERSION = 1 as const
export const STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL = "widget-contribution/1" as const
export const STORYBOOK_STORY_PRESENTATION_PROTOCOL = "story-presentation/1" as const
export const STORYBOOK_STANDARD_WIDGET_IDS = Object.freeze([
  "props",
  "source",
  "events",
  "diagnostics",
  "dom",
  "layout",
  "display",
  "reference",
] as const)

export type ExternalStorybookStandardWidgetId = typeof STORYBOOK_STANDARD_WIDGET_IDS[number]
export type ExternalStorybookStoryProjection = "display" | "world" | "hud"

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

export type ResolvedExternalStorybookAuthorStyleSheet = Readonly<{
  specifier: string
  path: string
  ownerRoot: string
  ownerPackageJsonPath: string
  contentDigest: string
}>

export type ResolvedExternalStorybookStandardWidgetContribution = Readonly<{
  id: ExternalStorybookStandardWidgetId
  kind: "standard"
}>

export type ResolvedExternalStorybookComponentWidgetContribution = Readonly<{
  id: string
  kind: "component"
  label: string
  module: ExternalStorybookModuleReference
}>

export type ResolvedExternalStorybookWidgetContribution =
  | ResolvedExternalStorybookStandardWidgetContribution
  | ResolvedExternalStorybookComponentWidgetContribution

export type ResolvedExternalStorybookWidgetContributions = Readonly<{
  protocol: typeof STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL
  items: readonly ResolvedExternalStorybookWidgetContribution[]
}>

export type ResolvedExternalStorybookStoryPresentation = Readonly<{
  protocol: typeof STORYBOOK_STORY_PRESENTATION_PROTOCOL
  projection: ExternalStorybookStoryProjection
  widgets: readonly string[]
}>

export type ResolvedExternalStorybookVariant = Readonly<{
  id: string
  label: string
  group: ExternalStorybookPresentationGroup | null
  route: string
  module: ExternalStorybookModuleReference | null
  resources: readonly ExternalStorybookResource[]
  presentation: ResolvedExternalStorybookStoryPresentation
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
  presentation: ResolvedExternalStorybookStoryPresentation
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
  authorStyleSheets: readonly ResolvedExternalStorybookAuthorStyleSheet[]
  widgetContributions: ResolvedExternalStorybookWidgetContributions | null
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
    "authorStyleSheets",
    "widgetContributions",
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
      const {record: packageJson} = await readJsonObject(
        packageJsonPath,
        "External Storybook package.json",
      )
      const packageName = packageId(packageJson.name, "External Storybook package.json name")
      if (packageName !== id) {
        throw new Error(`External Storybook package id ${id} does not match package.json name ${packageName}`)
      }
      const previousPackageOwner = state.packageJsonOwners.get(packageJsonPath)
      if (previousPackageOwner !== undefined) {
        throw new Error(`Ambiguous external Storybook package identity ${id}:\n${previousPackageOwner}\n${manifestPath}`)
      }
      state.packageJsonOwners.set(packageJsonPath, manifestPath)
      const authorStyleSheets = record.authorStyleSheets === undefined
        ? Object.freeze([]) as readonly ResolvedExternalStorybookAuthorStyleSheet[]
        : await resolveAuthorStyleSheets(
          record.authorStyleSheets,
          packageJson,
          packageJsonPath,
          id,
          scopeRoot,
        )
      const widgetContributions = record.widgetContributions === undefined
        ? null
        : await resolveWidgetContributions(
          record.widgetContributions,
          id,
          dirname(manifestPath),
          scopeRoot,
        )
      if (id === "@zavx0z/storybook" && widgetContributions === null) {
        throw new Error("@zavx0z/storybook must declare widget-contribution/1 standard registry")
      }
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
          widgetContributions,
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
        authorStyleSheets,
        widgetContributions,
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
  widgetContributions: ResolvedExternalStorybookWidgetContributions | null,
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
        ["id", "kind", "label", "route", "apiName", "readme", "tags", "aliases", "presentation", "variants"],
        ["id", "kind", "label", "presentation", "variants"],
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
      const presentation = resolveStoryPresentation(
        subject.presentation,
        `Catalog ${subjectPointer} presentation`,
        widgetContributions,
      )
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
          presentation,
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
        presentation,
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

async function resolveWidgetContributions(
  value: unknown,
  packageName: string,
  baseDirectory: string,
  scopeRoot: string,
): Promise<ResolvedExternalStorybookWidgetContributions> {
  const label = "External Storybook package widgetContributions"
  const record = objectValue(value, label)
  assertExactKeys(record, label, ["protocol", "items"], ["protocol", "items"])
  if (record.protocol !== STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL) {
    throw new Error(`Unsupported external Storybook widget contribution protocol: ${String(record.protocol)}`)
  }
  const candidates = arrayValue(record.items, `${label} items`)
  if (candidates.length > 32) throw new Error(`${label} items must contain at most 32 entries`)
  const reserved = new Set<string>(STORYBOOK_STANDARD_WIDGET_IDS)
  const ids = new Set<string>()
  const items: ResolvedExternalStorybookWidgetContribution[] = []
  for (const [index, value] of candidates.entries()) {
    const itemLabel = `${label} items ${index}`
    const item = objectValue(value, itemLabel)
    const kind = visibleText(item.kind, `${itemLabel} kind`)
    if (kind === "standard") {
      assertExactKeys(item, itemLabel, ["id", "kind"], ["id", "kind"])
      if (packageName !== "@zavx0z/storybook") {
        throw new Error(`Standard Storybook widgets can only be declared by @zavx0z/storybook: ${packageName}`)
      }
      const id = localId(item.id, `${itemLabel} id`)
      if (!reserved.has(id)) throw new Error(`Unknown standard Storybook widget id: ${id}`)
      assertUnique(ids, id, `Duplicate external Storybook widget contribution id: ${id}`)
      items.push(Object.freeze({id: id as ExternalStorybookStandardWidgetId, kind}))
      continue
    }
    if (kind !== "component") throw new Error(`Unknown external Storybook widget contribution kind: ${kind}`)
    assertExactKeys(item, itemLabel, ["id", "kind", "label", "module"], ["id", "kind", "label", "module"])
    const id = localId(item.id, `${itemLabel} id`)
    if (reserved.has(id)) throw new Error(`Storybook widget id is reserved by the standard registry: ${id}`)
    assertUnique(ids, id, `Duplicate external Storybook widget contribution id: ${id}`)
    items.push(Object.freeze({
      id,
      kind,
      label: visibleText(item.label, `${itemLabel} label`),
      module: await resolveModuleReference(
        item.module,
        baseDirectory,
        scopeRoot,
        `${itemLabel} module`,
        "path",
      ),
    }))
  }
  if (packageName === "@zavx0z/storybook") {
    const standardItems = items.filter(
      (item): item is ResolvedExternalStorybookStandardWidgetContribution => item.kind === "standard",
    )
    if (JSON.stringify(standardItems.map(({id}) => id)) !== JSON.stringify(STORYBOOK_STANDARD_WIDGET_IDS)) {
      throw new Error(
        `@zavx0z/storybook must declare the exact ordered standard widget registry: ${STORYBOOK_STANDARD_WIDGET_IDS.join(", ")}`,
      )
    }
    if (items.slice(0, standardItems.length).some((item) => item.kind !== "standard")) {
      throw new Error("@zavx0z/storybook standard widget registry must precede component contributions")
    }
  }
  return Object.freeze({
    protocol: STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL,
    items: Object.freeze(items),
  })
}

function resolveStoryPresentation(
  value: unknown,
  label: string,
  widgetContributions: ResolvedExternalStorybookWidgetContributions | null,
): ResolvedExternalStorybookStoryPresentation {
  const record = objectValue(value, label)
  assertExactKeys(record, label, ["protocol", "projection", "widgets"], ["protocol", "projection", "widgets"])
  if (record.protocol !== STORYBOOK_STORY_PRESENTATION_PROTOCOL) {
    throw new Error(`Unsupported external Storybook story presentation protocol: ${String(record.protocol)}`)
  }
  const projection = record.projection
  if (projection !== "display" && projection !== "world" && projection !== "hud") {
    throw new Error(`Unknown external Storybook story projection: ${String(projection)}`)
  }
  const widgetValues = arrayValue(record.widgets, `${label} widgets`)
  if (widgetValues.length < 2 || widgetValues.length > 32) {
    throw new Error(`${label} widgets must contain between 2 and 32 entries`)
  }
  const customIds = new Set(widgetContributions?.items
    .filter((item) => item.kind === "component")
    .map(({id}) => id) ?? [])
  const standardIds = new Set<string>(STORYBOOK_STANDARD_WIDGET_IDS)
  const widgets = widgetValues.map((candidate, index) => {
    const id = localId(candidate, `${label} widgets ${index}`)
    if (!standardIds.has(id) && !customIds.has(id)) {
      throw new Error(`Unknown external Storybook presentation widget: ${id}`)
    }
    return id
  })
  if (new Set(widgets).size !== widgets.length) throw new Error(`${label} widgets must not contain duplicates`)
  for (const required of ["source", "diagnostics"] as const) {
    if (!widgets.includes(required)) throw new Error(`${label} widgets must contain ${required}`)
  }
  return Object.freeze({
    protocol: STORYBOOK_STORY_PRESENTATION_PROTOCOL,
    projection,
    widgets: Object.freeze(widgets),
  })
}

async function resolveAuthorStyleSheets(
  value: unknown,
  packageJson: Record<string, unknown>,
  packageJsonPath: string,
  packageName: string,
  packageRoot: string,
): Promise<readonly ResolvedExternalStorybookAuthorStyleSheet[]> {
  const entries = nonEmptyArray(value, "External Storybook package authorStyleSheets")
  const specifiers = new Set<string>()
  const paths = new Set<string>()
  const resolved: ResolvedExternalStorybookAuthorStyleSheet[] = []
  for (const [index, candidate] of entries.entries()) {
    const label = `External Storybook package authorStyleSheets ${index}`
    const entry = objectValue(candidate, label)
    assertExactKeys(entry, label, ["specifier"], ["specifier"])
    const {specifier, ownerPackageName} = authorStyleSheetSpecifier(entry.specifier, `${label} specifier`)
    assertUnique(specifiers, specifier, `Duplicate external Storybook author stylesheet specifier: ${specifier}`)
    const owner = ownerPackageName === packageName
      ? Object.freeze({packageJson, packageJsonPath, packageRoot})
      : await resolveManifestReachedLocalDependency(
        packageJson,
        packageRoot,
        ownerPackageName,
        label,
      )
    const packageExports = objectValue(
      owner.packageJson.exports,
      `External Storybook ${ownerPackageName} package.json exports for authorStyleSheets`,
    )
    const exportKey = `.${specifier.slice(ownerPackageName.length)}`
    if (!Object.hasOwn(packageExports, exportKey)) {
      throw new Error(`External Storybook author stylesheet is not an exact package export: ${specifier}`)
    }
    const target = visibleText(
      packageExports[exportKey],
      `External Storybook author stylesheet export ${exportKey}`,
    )
    if (!target.startsWith("./") || /[?#*]/u.test(target) ||
      target.slice(2).split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
      throw new Error(`External Storybook author stylesheet export must be an exact relative file target: ${target}`)
    }
    const source = await readExactAuthorStyleSheet(
      owner.packageRoot,
      target,
      `author stylesheet export ${exportKey}`,
    )
    const path = source.path
    if (extname(path).toLowerCase() !== ".css") {
      throw new Error(`External Storybook author stylesheet must resolve to a CSS file: ${specifier}`)
    }
    assertUnique(paths, path, `External Storybook author stylesheet file is declared more than once: ${path}`)
    const contentDigest = createHash("sha256").update(source.bytes).digest("hex")
    resolved.push(Object.freeze({
      specifier,
      path,
      ownerRoot: owner.packageRoot,
      ownerPackageJsonPath: owner.packageJsonPath,
      contentDigest,
    }))
  }
  return Object.freeze(resolved)
}

function authorStyleSheetSpecifier(
  value: unknown,
  label: string,
): Readonly<{specifier: string; ownerPackageName: string}> {
  const specifier = visibleText(value, label)
  const segments = specifier.split("/")
  const ownerPackageName = specifier.startsWith("@")
    ? segments.length >= 3 ? `${segments[0]}/${segments[1]}` : ""
    : segments[0] ?? ""
  packageId(ownerPackageName, `${label} package`)
  const subpath = specifier.slice(ownerPackageName.length + 1)
  if (subpath.length === 0 || subpath.includes("\\") || /[?#*]/u.test(subpath) ||
    !subpath.endsWith(".css") ||
    subpath.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`${label} must be an exact public package subpath: ${specifier}`)
  }
  return Object.freeze({specifier, ownerPackageName})
}

async function resolveManifestReachedLocalDependency(
  packageJson: Record<string, unknown>,
  packageRoot: string,
  dependencyName: string,
  label: string,
): Promise<Readonly<{
  packageJson: Record<string, unknown>
  packageJsonPath: string
  packageRoot: string
}>> {
  type Owner = Readonly<{
    packageJson: Record<string, unknown>
    packageJsonPath: string
    packageRoot: string
  }>
  const queue: Owner[] = [Object.freeze({
    packageJson,
    packageJsonPath: join(packageRoot, "package.json"),
    packageRoot,
  })]
  const visitedRoots = new Set<string>()
  const matches = new Map<string, Owner>()
  let targetWasNonLocal = false
  while (queue.length > 0) {
    const owner = queue.shift()!
    if (visitedRoots.has(owner.packageRoot)) continue
    visitedRoots.add(owner.packageRoot)
    for (const [name, specifier] of localDependencyEntries(owner.packageJson)) {
      if (!isLocalDependencySpecifier(specifier)) {
        if (name === dependencyName) targetWasNonLocal = true
        continue
      }
      const dependency = await resolveExactLocalDependency(
        owner.packageRoot,
        name,
        specifier,
      )
      if (name === dependencyName) matches.set(dependency.packageRoot, dependency)
      if (!visitedRoots.has(dependency.packageRoot)) queue.push(dependency)
    }
  }
  if (matches.size === 1) return matches.values().next().value!
  if (matches.size > 1) {
    throw new Error(
      `Ambiguous manifest-reached local dependency for Storybook author stylesheet ${dependencyName}: ${
        [...matches.keys()].sort().join(", ")
      }`,
    )
  }
  if (targetWasNonLocal) {
    throw new Error(`Storybook author stylesheet dependency must be local: ${dependencyName}`)
  }
  throw new Error(`${label} specifier is neither self-owned nor a manifest-reached local dependency: ${dependencyName}`)
}

function localDependencyEntries(
  packageJson: Record<string, unknown>,
): readonly Readonly<[name: string, specifier: string]>[] {
  const byName = new Map<string, Set<string>>()
  for (const sectionName of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "devDependencies",
  ] as const) {
    const section = packageJson[sectionName]
    if (section === undefined) continue
    const dependencies = objectValue(section, `External Storybook package.json ${sectionName}`)
    for (const [name, value] of Object.entries(dependencies)) {
      packageId(name, `External Storybook local dependency name`)
      const specifier = visibleText(value, `External Storybook local dependency ${name}`)
      const values = byName.get(name) ?? new Set<string>()
      values.add(specifier)
      byName.set(name, values)
    }
  }
  const entries: Array<Readonly<[string, string]>> = []
  for (const [name, specifiers] of [...byName].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0)) {
    const localSpecifiers = [...specifiers].filter(isLocalDependencySpecifier)
    if (new Set(localSpecifiers).size > 1) {
      throw new Error(`Conflicting local dependency specifiers for Storybook author stylesheet: ${name}`)
    }
    entries.push(Object.freeze([
      name,
      localSpecifiers[0] ?? [...specifiers].sort()[0]!,
    ] as const))
  }
  return Object.freeze(entries)
}

function isLocalDependencySpecifier(value: string): boolean {
  return /^(?:link:|workspace:|file:|portal:)/u.test(value)
}

async function resolveExactLocalDependency(
  packageRoot: string,
  dependencyName: string,
  dependencySpecifier: string,
): Promise<Readonly<{
  packageJson: Record<string, unknown>
  packageJsonPath: string
  packageRoot: string
}>> {
  const separator = dependencySpecifier.indexOf(":")
  const protocol = dependencySpecifier.slice(0, separator + 1)
  const target = dependencySpecifier.slice(separator + 1)
  const dependencyRoot = (protocol === "link:" || protocol === "file:" || protocol === "portal:") &&
    (target.startsWith(".") || isAbsolute(target))
    ? await canonicalDependencyDirectory(resolve(packageRoot, target), dependencyName)
    : await installedLocalDependencyDirectory(packageRoot, dependencyName)
  const dependencyPackageJsonPath = join(dependencyRoot, "package.json")
  const {record: dependencyPackageJson} = await readExactJsonObject(
    dependencyPackageJsonPath,
    `External Storybook local dependency ${dependencyName} package.json`,
  )
  if (packageId(dependencyPackageJson.name, `local dependency ${dependencyName} name`) !== dependencyName) {
    throw new Error(`Storybook local dependency identity mismatch: ${dependencyName}`)
  }
  return Object.freeze({
    packageJson: dependencyPackageJson,
    packageJsonPath: dependencyPackageJsonPath,
    packageRoot: dependencyRoot,
  })
}

async function installedLocalDependencyDirectory(
  packageRoot: string,
  dependencyName: string,
): Promise<string> {
  const segments = dependencyName.split("/")
  let directory = packageRoot
  while (true) {
    try {
      return await canonicalDependencyDirectory(
        join(directory, "node_modules", ...segments),
        dependencyName,
      )
    } catch {
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  throw new Error(`Cannot resolve manifest-reached local dependency for Storybook author stylesheet: ${dependencyName}`)
}

async function canonicalDependencyDirectory(path: string, dependencyName: string): Promise<string> {
  let canonical: string
  try {
    canonical = await realpath(path)
  } catch (error) {
    throw new Error(`Storybook local dependency does not exist: ${dependencyName}`, {cause: error})
  }
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error(`Storybook local dependency must be a directory: ${dependencyName}`)
  }
  return canonical
}

async function readExactAuthorStyleSheet(
  ownerRoot: string,
  target: string,
  label: string,
): Promise<Readonly<{path: string; bytes: Buffer}>> {
  validateRelativePath(target, label)
  const lexical = resolve(ownerRoot, target)
  if (!isContained(ownerRoot, lexical)) {
    throw new Error(`External Storybook ${label} escapes scope root: ${target}`)
  }
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(lexical, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    throw new Error(`External Storybook ${label} must be an exact non-symlink file: ${lexical}`, {cause: error})
  }
  try {
    const [opened, canonical] = await Promise.all([handle.stat(), realpath(lexical)])
    if (!opened.isFile() || !isContained(ownerRoot, canonical)) {
      throw new Error(`External Storybook ${label} escapes its exact owner package: ${target}`)
    }
    const current = await stat(canonical)
    if (opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new Error(`External Storybook ${label} changed during resolution: ${target}`)
    }
    return Object.freeze({path: canonical, bytes: await handle.readFile()})
  } finally {
    await handle.close()
  }
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
    validateExternalStorybookModulePath(record[pathField], `${label} path`),
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
  const allPaths = [...overviews.keys(), ...leaves.keys()]
  for (const path of leaves.keys()) {
    for (const other of allPaths) {
      if (path !== other && other.startsWith(`${path}/`)) {
        throw new Error(`External Storybook leaf route cannot contain another route: ${path}; ${other}`)
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

async function readJsonObject(
  path: string,
  label: string,
): Promise<Readonly<{record: Record<string, unknown>, digest: string}>> {
  const source = await readFile(path, "utf8")
  return parseJsonObject(source, path, label)
}

async function readExactJsonObject(
  path: string,
  label: string,
): Promise<Readonly<{record: Record<string, unknown>, digest: string}>> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    throw new Error(`${label} must be an exact non-symlink file: ${path}`, {cause: error})
  }
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`${label} must be a file: ${path}`)
    return parseJsonObject(await handle.readFile("utf8"), path, label)
  } finally {
    await handle.close()
  }
}

function parseJsonObject(
  source: string,
  path: string,
  label: string,
): Readonly<{record: Record<string, unknown>, digest: string}> {
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
  return validateExternalStorybookScopeId(value, label)
}

function packageId(value: unknown, label: string): string {
  return validateExternalStorybookPackageId(value, label)
}

function localId(value: unknown, label: string): string {
  return validateExternalStorybookScopeId(value, label)
}

function routePath(value: unknown, label: string): string {
  return validateExternalStorybookRoute(value, label)
}

function exportText(value: unknown, label: string): string {
  return validateExternalStorybookExportName(value, label)
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
