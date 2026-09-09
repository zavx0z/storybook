/**
 * Versioned JSON declaration discovery for the external Storybook.
 *
 * The resolver reads data only. It canonicalizes every owner path through
 * canonical directory chains, preserves exact hardlinked owner leaf paths,
 * rejects paths outside the declaring scope, verifies exact package identity
 * and statically checks requested ESM exports without executing owner modules.
 */

import type {
  StorybookCatalog,
  StorybookPackage,
  StorybookCatalogScope,
  StorybookPackageCatalog,
  StorybookCatalogScopeKind,
  StorybookStandardWidgetId,
  StorybookPresentationGroup,
  StorybookModuleReference,
  StorybookResourceKind,
  StorybookResource,
  StorybookAuthorStyleSheet,
  StorybookStandardWidgetContribution,
  StorybookWidgetContribution,
  StorybookWidgetContributions,
  StorybookStoryPresentation,
  StorybookVariant,
  StorybookSubject,
  StorybookCategory,
} from "../catalog/catalog.t.ts"
import {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
  STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL,
  STORYBOOK_STORY_PRESENTATION_PROTOCOL,
  STORYBOOK_STANDARD_WIDGET_IDS,
} from "../catalog/protocol.ts"

import {discoverWorkspacePackages} from "./workspaces.ts"
import {discoverStorybookDirectories} from "./directories.ts"
import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {lstat, open, realpath, readFile, stat} from "node:fs/promises"
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
  deriveExternalStorybookScopeId,
  validateExternalStorybookExportName,
  validateExternalStorybookModulePath,
  validateExternalStorybookPackageId,
  validateExternalStorybookRoute,
  validateExternalStorybookScopeId,
} from "./declaration-law.ts"

type ResolveState = {
  previous?: StorybookCatalog
  recoveryPaths: Set<string>
  scopes: StorybookCatalogScope[]
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
    "readme",
    "projects",
  ]),
  project: Object.freeze([
    "$schema",
    "schemaVersion",
    "kind",
    "id",
    "readme",
    "packages",
  ]),
  package: Object.freeze([
    "$schema",
    "schemaVersion",
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
  previous?: StorybookCatalog,
): Promise<StorybookCatalog> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("External Storybook requires at least one declaration or root")
  }
  const state: ResolveState = {
    ...(previous === undefined ? {} : {previous}),
    recoveryPaths: new Set(),
    scopes: [],
    scopeIds: new Map(),
    packageJsonOwners: new Map(),
    completed: new Set(),
    visiting: [],
  }
  const rootIds: string[] = []
  for (const [index, input] of inputs.entries()) {
    const checkedInput = visibleText(input, `External Storybook root ${index}`)
    const manifestPath = await resolveEntryManifest(checkedInput).catch(error => {
      const retained = previous?.scopes.find(scope => scope.source.path === resolve(input) || scope.scopeRoot === resolve(input))
      if (previous === undefined) throw error
      return retained?.source.path ?? (basename(input) === "manifest.json" && basename(dirname(input)) === ".storybook"
        ? resolve(input) : join(resolve(input), ".storybook", "manifest.json"))
    })
    const declaration = await resolveManifest(manifestPath, state)
    rootIds.push(declaration.canonicalId)
  }
  const normalized = await normalizePackageOwners(state.scopes, rootIds)
  state.scopes = normalized.scopes
  rootIds.splice(0, rootIds.length, ...normalized.rootIds)
  nestPackageScopes(state.scopes, rootIds)
  const packageRoots = new Set(state.scopes.map(scope => scope.scopeRoot))
  for (const [index, scope] of state.scopes.entries()) {
    if (scope.resolutionError !== undefined) continue
    try {
      const found = await discoverStorybookDirectories(scope.scopeRoot, packageRoots)
      if (scope.kind === "package") for (const subject of scope.catalog?.categories.flatMap(category => category.subjects) ?? []) {
        if (subject.directory !== undefined && !found.directories.some(directory => directory.relativePath === subject.directory && directory.structuralRole === "module")) {
          throw new Error(`Storybook subject directory must be an existing module with src: ${scope.id}/${subject.directory}`)
        }
      }
      state.scopes[index] = Object.freeze({
        ...scope,
        directories: found.directories,
        structurePaths: Object.freeze([...new Set([...(scope.structurePaths ?? []), ...found.watchPaths])]),
      })
    } catch (error) {
      if (previous === undefined) throw error
      const retained = previous.scopes.find(item => item.id === scope.id)
      state.scopes[index] = Object.freeze({...(retained ?? scope), resolutionError: error instanceof Error ? error.message : String(error),
        ...(retained ? {} : {catalog: null}),
        structurePaths: Object.freeze([...new Set([...(retained?.structurePaths ?? []), ...(scope.structurePaths ?? [])])]),
      })
    }
  }
  return Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    rootIds: Object.freeze(rootIds),
    scopes: Object.freeze([...state.scopes]),
  })
}

/** Legacy composition files supply children, never a second owner identity. */
async function normalizePackageOwners(scopes: readonly StorybookCatalogScope[], roots: readonly string[]) {
  const identities = new Map<string, string>()
  const names = new Map<string, string>()
  for (const scope of scopes) {
    if (scope.kind === "unavailable") {
      names.set(scope.canonicalId, scope.id)
      identities.set(scope.canonicalId, scope.canonicalId)
      continue
    }
    const name = scope.kind === "package" ? scope.packageName : packageId(
      (await readJsonObject(join(scope.scopeRoot, "package.json"), "Owner package.json")).record.name,
      "Owner package.json name",
    )
    names.set(scope.canonicalId, name)
    identities.set(scope.canonicalId, externalStorybookDeclarationId("package", name))
  }
  const normalized = scopes.map((scope): StorybookCatalogScope => {
    if (scope.kind === "unavailable") return scope
    const name = names.get(scope.canonicalId)!
    const children = scope.kind === "workspace" ? scope.projectIds : scope.packageIds ?? []
    const legacyUrls = scope.kind === "package"
      ? roots.includes(scope.canonicalId) ? [`/projects/${deriveExternalStorybookScopeId(name)}/`] : []
      : scope.legacyUrls ?? []
    const {projectIds: _projects, ...base} = scope as StorybookCatalogScope & {projectIds?: readonly string[]}
    const owner = scope.kind === "package" ? scope : {
      ...base, kind: "package" as const,
      packageName: name, packageJsonPath: join(scope.scopeRoot, "package.json"),
      authorStyleSheets: Object.freeze([]), widgetContributions: null, runtime: null, catalog: null,
    }
    return Object.freeze({
      ...owner,
      kind: "package" as const,
      id: name,
      canonicalId: identities.get(scope.canonicalId)!,
      packageIds: Object.freeze(children.map(id => identities.get(id)!)),
      legacyUrls: Object.freeze([...new Set([...(scope.legacyUrls ?? []), ...legacyUrls])]),
    })
  })
  return {scopes: normalized, rootIds: roots.map(id => identities.get(id)!)}
}

/** Directory containment affects navigation only, never package module ownership. */
function nestPackageScopes(scopes: StorybookCatalogScope[], rootIds: readonly string[]): void {
  for (const rootId of rootIds) {
    const root = scopes.find(scope => scope.canonicalId === rootId)!
    const memberIds = new Set<string>()
    const include = (id: string): void => {
      if (memberIds.has(id)) return
      memberIds.add(id)
      const owner = scopes.find(scope => scope.canonicalId === id)
      if (owner?.kind === "package") for (const child of owner.packageIds ?? []) include(child)
    }
    include(rootId)
    const members = scopes.filter(scope => memberIds.has(scope.canonicalId))
    const children = new Map<string, string[]>()
    for (const member of members) {
      if (member === root) continue
      const parent = members.filter(candidate => candidate !== member &&
        isContained(candidate.scopeRoot, member.scopeRoot))
        .sort((left, right) => right.scopeRoot.length - left.scopeRoot.length)[0]
      const parentId = parent?.canonicalId ?? rootId
      const list = children.get(parentId) ?? []
      list.push(member.canonicalId)
      children.set(parentId, list)
    }
    for (const member of members) {
      const index = scopes.indexOf(member)
      scopes[index] = Object.freeze({...member, packageIds: Object.freeze(children.get(member.canonicalId) ?? [])})
    }
  }
}

/** Reads only the package-owned Workbench CSS contract, independently of its documentation catalog. */
export async function resolveExternalStorybookAuthorStyleSheets(root: string): Promise<readonly StorybookAuthorStyleSheet[]> {
  const manifestPath = await resolveEntryManifest(root)
  const scopeRoot = await manifestScopeRoot(manifestPath)
  const {record} = await readJsonObject(manifestPath, "Workbench manifest")
  assertExactKeys(record, "Workbench manifest", MANIFEST_KEYS.package, ["schemaVersion"])
  if (record.schemaVersion !== EXTERNAL_STORYBOOK_SCHEMA_VERSION) throw new Error("Unsupported Workbench manifest schemaVersion")
  const packageJsonPath = await resolveContainedFile(scopeRoot, "package.json", scopeRoot, "packageJson")
  const {record: metadata} = await readJsonObject(packageJsonPath, "Workbench package.json")
  const id = packageId(metadata.name, "Workbench package identity")
  return record.authorStyleSheets === undefined ? Object.freeze([]) :
    resolveAuthorStyleSheets(record.authorStyleSheets, metadata, packageJsonPath, id, scopeRoot)
}

/** Returns the stable canonical declaration identity used by the normalized graph. */
export function externalStorybookDeclarationId(
  kind: StorybookCatalogScopeKind,
  id: string,
): string {
  return `${kind}:${id}`
}

async function resolveManifest(manifestPath: string, state: ResolveState, packageOnly = false): Promise<StorybookCatalogScope> {
  if (state.previous === undefined) return resolveManifestStrict(manifestPath, state, packageOnly)
  const checkpoint = {
    scopes: [...state.scopes], scopeIds: new Map(state.scopeIds),
    packageJsonOwners: new Map(state.packageJsonOwners), completed: new Set(state.completed),
    visiting: [...state.visiting],
  }
  try {
    return await resolveManifestStrict(manifestPath, state, packageOnly)
  } catch (error) {
    Object.assign(state, checkpoint)
    const message = error instanceof Error ? error.message : String(error)
    const missing = message.match(/does not exist: (.+)$/u)?.[1]
    if (missing !== undefined) state.recoveryPaths.add(missing)
    // Conflicting identities cannot be accepted by choosing an arbitrary winner.
    if (/Duplicate|Ambiguous|Cyclic|referenced more than once/u.test(message)) throw error
    const previous = state.previous.scopes.find(scope => scope.source.path === manifestPath || scope.scopeRoot === (basename(manifestPath) === "package.json" ? dirname(manifestPath) : dirname(dirname(manifestPath))))
    const owner = previous ?? await unavailableOwner(manifestPath)
    const retained = previous === undefined ? [] : previousSubtree(state.previous, previous)
    const recoveryPaths = Object.freeze([...new Set([
      manifestPath, ...state.recoveryPaths,
      ...(previous?.recoveryPaths ?? []),
    ])])
    const failed = Object.freeze({...owner, resolutionError: message, recoveryPaths})
    for (const scope of [...retained.filter(scope => scope.canonicalId !== owner.canonicalId), failed]) {
      if (state.scopeIds.has(scope.id)) throw new Error(`Duplicate external Storybook scope id ${scope.id}`)
      state.scopes.push(scope)
      state.scopeIds.set(scope.id, scope.source.path)
      state.completed.add(scope.source.path)
      if (scope.kind === "package") state.packageJsonOwners.set(scope.packageJsonPath, scope.source.path)
    }
    return failed
  }
}

function previousSubtree(catalog: StorybookCatalog, root: StorybookCatalogScope): StorybookCatalogScope[] {
  const ids = root.kind === "workspace" ? root.projectIds : root.kind === "project" || root.kind === "package" ? root.packageIds ?? [] : []
  return [...ids.flatMap(id => {
    const child = catalog.scopes.find(scope => scope.canonicalId === id)
    return child === undefined ? [] : previousSubtree(catalog, child)
  }), root]
}

async function unavailableOwner(manifestPath: string): Promise<StorybookCatalogScope> {
  const scopeRoot = await sourceScopeRoot(manifestPath).catch(() => resolve(dirname(manifestPath), ".."))
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const record = object(await readJsonObject(manifestPath, "Unavailable owner manifest").then(value => value.record).catch(() => null))
  const metadata = object(await readJsonObject(join(scopeRoot, "package.json"), "Unavailable owner package.json").then(value => value.record).catch(() => null))
  let kind: StorybookCatalogScopeKind | "unavailable" = record.kind === "workspace" || record.kind === "project" ? record.kind : "package"
  let id: string
  try {
    id = packageId(metadata.name, "Unavailable package identity")
  } catch {
    // An unavailable selected directory is a registration shell, never an invented package identity.
    kind = "unavailable"
    id = `unavailable-${createHash("sha256").update(scopeRoot).digest("hex").slice(0, 24)}`
  }
  const base = {
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION, kind, id,
    canonicalId: `${kind}:${id}`, scopeRoot,
    label: typeof metadata.label === "string" && metadata.label.trim().length > 0 ? metadata.label : `${basename(scopeRoot)} (недоступен)`,
    source: Object.freeze({path: manifestPath, pointer: ""}), readmePath: null,
    digest: createHash("sha256").update(manifestPath).digest("hex"),
  }
  if (kind === "workspace") return Object.freeze({...base, kind, projectIds: Object.freeze([])})
  if (kind === "project") return Object.freeze({...base, kind, packageIds: Object.freeze([])})
  if (kind === "unavailable") return Object.freeze({...base, kind})
  return Object.freeze({...base, kind, packageName: id, packageJsonPath: join(scopeRoot, "package.json"),
    authorStyleSheets: Object.freeze([]), widgetContributions: null, runtime: null, catalog: null})
}

async function resolveManifestStrict(
  manifestPath: string,
  state: ResolveState,
  packageOnly: boolean,
): Promise<StorybookCatalogScope> {
  const cycleIndex = state.visiting.indexOf(manifestPath)
  if (cycleIndex >= 0) {
    const cycle = [...state.visiting.slice(cycleIndex), manifestPath]
    throw new Error(`Cyclic external Storybook declarations:\n${cycle.join("\n")}`)
  }
  if (state.completed.has(manifestPath)) {
    throw new Error(`External Storybook declaration is referenced more than once: ${manifestPath}`)
  }

  state.recoveryPaths = new Set([manifestPath])
  const scopeRoot = await sourceScopeRoot(manifestPath)
  const structural = basename(manifestPath) === "package.json"
  const {record: sourceRecord, digest: manifestDigest} = await readJsonObject(manifestPath, "External Storybook source")
  const record: Record<string, unknown> = structural
    ? {
      schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    }
    : sourceRecord
  const schemaVersion = record.schemaVersion
  if (schemaVersion !== EXTERNAL_STORYBOOK_SCHEMA_VERSION) {
    throw new Error(`Unsupported external Storybook manifest schemaVersion: ${String(schemaVersion)}`)
  }
  const kindValue = record.kind ?? "package"
  if (kindValue !== "workspace" && kindValue !== "project" && kindValue !== "package") {
    throw new Error(`Unknown external Storybook manifest kind: ${String(kindValue)}`)
  }
  const kind = kindValue
  assertExactKeys(
    record,
    `External Storybook ${kind} manifest`,
    MANIFEST_KEYS[kind],
    kind === "workspace"
      ? ["schemaVersion", "kind", "id", "projects"]
      : kind === "project"
        ? ["schemaVersion", "kind", "id"]
        : ["schemaVersion"],
  )
  optionalString(record, "$schema", `External Storybook ${kind} $schema`)
  if (kind !== "package") packageId(record.id, `External Storybook ${kind} id`)
  const ownerPackagePath = join(scopeRoot, "package.json")
  state.recoveryPaths.add(ownerPackagePath)
  const ownerPackage = (await readJsonObject(
    await resolveContainedFile(scopeRoot, "package.json", scopeRoot, "owner package.json"),
    "Owner package.json",
  )).record
  const id = packageId(ownerPackage.name, "Owner package.json name")
  const label = visibleText(ownerPackage.label, `External Storybook ${kind} package.json label`)
  let digest = createHash("sha256").update(manifestDigest).update(JSON.stringify(label)).digest("hex")
  const previousScope = state.scopeIds.get(id)
  if (previousScope !== undefined) {
    const identity = kind === "package" ? "Ambiguous external Storybook package identity" : "Duplicate external Storybook scope id"
    throw new Error(`${identity} ${id}:\n${previousScope}\n${manifestPath}`)
  }
  state.scopeIds.set(id, manifestPath)
  const readmePath = record.readme === undefined
    ? await Bun.file(join(scopeRoot, "README.md")).exists()
      ? await resolveContainedFile(scopeRoot, "README.md", scopeRoot, "package README")
      : null
    : await resolveContainedFile(
      dirname(manifestPath),
      requiredPath(`${kind} readme`, record.readme),
      scopeRoot,
      `${kind} readme`,
    )
  const canonicalId = externalStorybookDeclarationId(kind, id)

  state.visiting.push(manifestPath)
  try {
    let declaration: StorybookCatalogScope
    let structurePaths: readonly string[] = [join(scopeRoot, "README.md")]
    if (kind === "workspace") {
      const references = declarationReferences(record.projects, "workspace projects")
      const projectIds: string[] = []
      for (const [index, reference] of references.entries()) {
        const childPath = await resolveContainedFile(
          dirname(manifestPath),
          reference,
          scopeRoot,
          `workspace project declaration ${index}`,
        ).catch(error => {
          if (state.previous === undefined || !/does not exist|missing/u.test(String(error))) throw error
          validateRelativePath(reference, "child declaration")
          const candidate = resolve(dirname(manifestPath), reference)
          if (!isContained(scopeRoot, candidate)) throw error
          return candidate
        })
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
        source: Object.freeze({path: manifestPath, pointer: ""}),
        scopeRoot,
        readmePath,
        digest,
        projectIds: Object.freeze(projectIds),
      })
    } else if (kind === "project") {
      const packageIds: string[] = []
      if (ownerPackage.workspaces !== undefined) {
        if (record.packages !== undefined) throw new Error("Project composition must use either package.json workspaces or manifest packages, not both")
        const discovered = await discoverWorkspacePackages(scopeRoot, ownerPackage.workspaces)
        structurePaths = [...structurePaths, ...discovered.watchPaths]
        digest = createHash("sha256").update(digest).update(JSON.stringify(ownerPackage.workspaces)).update(JSON.stringify(discovered.roots)).digest("hex")
        for (const root of discovered.roots) {
          const source = await resolveEntryManifest(root)
          const child = state.scopes.find(scope => scope.source.path === source) ?? await resolveManifest(source, state, true)
          if (child.kind !== "package") throw new Error(`Workspace member must be a package: ${root}`)
          packageIds.push(child.canonicalId)
        }
      } else {
        const references = declarationReferences(record.packages, "project packages")
        for (const [index, reference] of references.entries()) {
          const childPath = await resolveContainedFile(
            dirname(manifestPath),
            reference,
            scopeRoot,
            `project package declaration ${index}`,
          ).catch(error => {
            if (state.previous === undefined || !/does not exist|missing/u.test(String(error))) throw error
            validateRelativePath(reference, "child declaration")
            const candidate = resolve(dirname(manifestPath), reference)
            if (!isContained(scopeRoot, candidate)) throw error
            return candidate
          })
          const child = await resolveManifest(childPath, state)
          if (child.kind !== "package") {
            throw new Error(`Project declaration must reference a package, received ${child.kind}: ${childPath}`)
          }
          packageIds.push(child.canonicalId)
        }
      }
      declaration = Object.freeze({
        schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
        kind,
        canonicalId,
        id,
        label,
        source: Object.freeze({path: manifestPath, pointer: ""}),
        scopeRoot,
        readmePath,
        digest,
        packageIds: Object.freeze(packageIds),
      })
    } else {
      const packageJsonPath = await resolveContainedFile(
        scopeRoot,
        "package.json",
        scopeRoot,
        "package packageJson",
      )
      const packageJson = ownerPackage
      const packageName = id
      const previousPackageOwner = state.packageJsonOwners.get(packageJsonPath)
      if (previousPackageOwner !== undefined) {
        throw new Error(`Ambiguous external Storybook package identity ${id}:\n${previousPackageOwner}\n${manifestPath}`)
      }
      state.packageJsonOwners.set(packageJsonPath, manifestPath)
      const authorStyleSheets = record.authorStyleSheets === undefined
        ? Object.freeze([]) as readonly StorybookAuthorStyleSheet[]
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
      if (typeof record.catalog === "string") state.recoveryPaths.add(resolve(dirname(manifestPath), record.catalog))
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
        source: Object.freeze({path: manifestPath, pointer: ""}),
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
      if (ownerPackage.workspaces !== undefined) {
        const discovered = await discoverWorkspacePackages(scopeRoot, ownerPackage.workspaces)
        structurePaths = [...structurePaths, ...discovered.watchPaths]
        const packageIds: string[] = []
        for (const root of discovered.roots) {
          const source = await resolveEntryManifest(root)
          const child = state.scopes.find(scope => scope.source.path === source) ?? await resolveManifest(source, state, true)
          if (child.kind !== "package") throw new Error(`Workspace member must be a package: ${root}`)
          packageIds.push(child.canonicalId)
        }
        declaration = Object.freeze({...declaration, packageIds: Object.freeze(packageIds)})
      }
    }
    const optionalManifest = join(scopeRoot, ".storybook", "manifest.json")
    declaration = Object.freeze({...declaration, structurePaths: Object.freeze([
      ...structurePaths,
      scopeRoot,
      join(scopeRoot, ".storybook"),
      optionalManifest,
    ]), ...(kind === "package" ? {} : {legacyUrls: Object.freeze([`/${kind}s/${encodeURIComponent(String(record.id))}/`])})})
    state.completed.add(manifestPath)
    state.scopes.push(declaration)
    return declaration
  } finally {
    const popped = state.visiting.pop()
    if (popped !== manifestPath) throw new Error("External Storybook declaration traversal was corrupted")
  }
}

async function resolveCatalog(
  catalogPath: string,
  scopeRoot: string,
  widgetContributions: StorybookWidgetContributions | null,
): Promise<StorybookPackageCatalog> {
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
  const categories: StorybookCategory[] = []
  for (const [categoryIndex, value] of categoryValues.entries()) {
    const pointer = `/categories/${categoryIndex}`
    const category = objectValue(value, `Catalog ${pointer}`)
    assertExactKeys(
      category,
      `Catalog ${pointer}`,
      ["id", "label", "kind", "apiName", "route", "group", "subjects"],
      ["id", "label", "subjects"],
    )
    const id = localId(category.id, `Catalog ${pointer} id`)
    assertUnique(categoryIds, id, `Duplicate external Storybook category id: ${id}`)
    const label = visibleText(category.label, `Catalog ${pointer} label`)
    const categoryKind = category.kind === undefined
      ? null
      : localId(category.kind, `Catalog ${pointer} kind`)
    const categoryApiName = category.apiName === undefined
      ? null
      : visibleText(category.apiName, `Catalog ${pointer} apiName`)
    if ((categoryKind === null) !== (categoryApiName === null)) {
      throw new Error(`Catalog ${pointer} kind and apiName must be declared together`)
    }
    const categoryRoute = category.route === undefined
      ? id
      : routePath(category.route, `Catalog ${pointer} route`)
    const group = optionalGroup(category.group, `Catalog ${pointer} group`, categoryGroups)
    const subjectValues = nonEmptyArray(category.subjects, `Catalog ${pointer} subjects`)
    const subjectIds = new Set<string>()
    const subjects: StorybookSubject[] = []
    for (const [subjectIndex, subjectValue] of subjectValues.entries()) {
      const subjectPointer = `${pointer}/subjects/${subjectIndex}`
      const subject = objectValue(subjectValue, `Catalog ${subjectPointer}`)
      assertExactKeys(
        subject,
        `Catalog ${subjectPointer}`,
        ["id", "kind", "label", "route", "apiName", "readme", "tags", "aliases", "presentation", "variants", "directory"],
        ["id", "kind", "label", "presentation", "variants"],
      )
      const subjectId = localId(subject.id, `Catalog ${subjectPointer} id`)
      const directory = subject.directory === undefined ? undefined : routePath(subject.directory, `Catalog ${subjectPointer} directory`)
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
      const variants: StorybookVariant[] = []
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
          ? Object.freeze([]) as readonly StorybookResource[]
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
          source: Object.freeze({path: catalogPath, pointer: variantPointer}),
        }))
      }
      subjects.push(Object.freeze({
        ...(directory === undefined ? {} : {directory}),
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
        source: Object.freeze({path: catalogPath, pointer: subjectPointer}),
      }))
    }
    categories.push(Object.freeze({
      id,
      route: categoryRoute,
      label,
      kind: categoryKind,
      apiName: categoryApiName,
      group,
      subjects: Object.freeze(subjects),
      source: Object.freeze({path: catalogPath, pointer}),
    }))
  }
  validateCatalogRoutes(categories)
  return Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    sourcePaths: Object.freeze([catalogPath]),
    digest,
    categories: Object.freeze(categories),
  })
}

async function resolveResources(
  value: unknown,
  baseDirectory: string,
  scopeRoot: string,
  label: string,
): Promise<readonly StorybookResource[]> {
  const record = objectValue(value, label)
  const keys = ["fixture", "tests", "media", "references", "evidence", "assets"] as const
  assertExactKeys(record, label, keys, [])
  const output: StorybookResource[] = []
  const seen = new Set<string>()
  const append = async (kind: StorybookResourceKind, pathValue: unknown): Promise<void> => {
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
): Promise<StorybookWidgetContributions> {
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
  const items: StorybookWidgetContribution[] = []
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
      items.push(Object.freeze({id: id as StorybookStandardWidgetId, kind}))
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
      (item): item is StorybookStandardWidgetContribution => item.kind === "standard",
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
  widgetContributions: StorybookWidgetContributions | null,
): StorybookStoryPresentation {
  const record = objectValue(value, label)
  assertExactKeys(record, label, ["protocol", "projection", "widgets"], ["protocol", "projection", "widgets"])
  if (record.protocol !== STORYBOOK_STORY_PRESENTATION_PROTOCOL) {
    throw new Error(`Unsupported external Storybook story presentation protocol: ${String(record.protocol)}`)
  }
  const projection = record.projection
  if (projection !== "display" && projection !== "hud" && projection !== "space") {
    throw new Error(`Unsupported external Storybook presentation projection: ${String(projection)}`)
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
): Promise<readonly StorybookAuthorStyleSheet[]> {
  const entries = nonEmptyArray(value, "External Storybook package authorStyleSheets")
  const specifiers = new Set<string>()
  const paths = new Set<string>()
  const resolved: StorybookAuthorStyleSheet[] = []
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
  const opened = await openExactOwnerFile(
    lexical,
    `External Storybook ${label}`,
    "exact",
  )
  try {
    if (!isContained(ownerRoot, opened.path)) {
      throw new Error(`External Storybook ${label} escapes its exact owner package: ${target}`)
    }
    return Object.freeze({path: opened.path, bytes: await opened.handle.readFile()})
  } finally {
    await opened.handle.close()
  }
}

async function resolveModuleReference(
  value: unknown,
  baseDirectory: string,
  scopeRoot: string,
  label: string,
  pathField: "module" | "path",
): Promise<StorybookModuleReference> {
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
      resolved = await resolveContainedAbsoluteFile(
        Bun.resolveSync(specifier, dirname(modulePath)),
        scopeRoot,
        "module re-export",
      )
    } catch {
      continue
    }
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

function validateCatalogRoutes(categories: readonly StorybookCategory[]): void {
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
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" ||
      basename(absolute) !== "manifest.json" || basename(dirname(absolute)) !== ".storybook") {
      throw new Error(`External Storybook declaration or root does not exist: ${absolute}`, {cause: error})
    }
  }
  if (metadata?.isDirectory()) {
    candidate = basename(absolute) === ".storybook"
      ? join(absolute, "manifest.json")
      : join(absolute, ".storybook", "manifest.json")
  }
  if (basename(absolute) === "package.json" && metadata?.isFile()) {
    candidate = join(dirname(absolute), ".storybook", "manifest.json")
  }
  try {
    return await canonicalManifest(candidate)
  } catch (error) {
    if (!(error instanceof Error) || !/missing|does not exist/u.test(error.message)) throw error
    const root = metadata?.isDirectory()
      ? basename(absolute) === ".storybook" ? dirname(absolute) : absolute
      : basename(absolute) === "package.json" ? dirname(absolute) : dirname(dirname(absolute))
    const opened = await openExactOwnerFile(join(root, "package.json"), "External Storybook package.json", "missing")
    await opened.handle.close()
    return opened.path
  }
}

async function sourceScopeRoot(path: string): Promise<string> {
  return basename(path) === "package.json" ? await realpath(dirname(path)) : manifestScopeRoot(path)
}

async function canonicalManifest(path: string): Promise<string> {
  const opened = await openExactOwnerFile(path, "External Storybook manifest", "missing")
  try {
    await manifestScopeRoot(opened.path)
    return opened.path
  } finally {
    await opened.handle.close()
  }
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
  return await resolveContainedAbsoluteFile(lexical, scopeRoot, label)
}

async function resolveContainedAbsoluteFile(
  lexical: string,
  scopeRoot: string,
  label: string,
): Promise<string> {
  const opened = await openExactOwnerFile(
    lexical,
    `External Storybook ${label}`,
    "missing",
  )
  try {
    if (!isContained(scopeRoot, opened.path)) {
      throw new Error(`External Storybook ${label} escapes scope root after realpath: ${lexical}`)
    }
    return opened.path
  } finally {
    await opened.handle.close()
  }
}

async function openExactOwnerFile(
  lexical: string,
  label: string,
  missing: "missing" | "exact",
): Promise<Readonly<{
  path: string
  handle: Awaited<ReturnType<typeof open>>
}>> {
  let canonicalParent: string
  try {
    canonicalParent = await realpath(dirname(lexical))
  } catch (error) {
    throw new Error(`${label} does not exist: ${lexical}`, {cause: error})
  }
  const path = join(canonicalParent, basename(lexical))
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    const code = (error as Readonly<{code?: unknown}>).code
    if (missing === "missing" && code === "ENOENT") {
      throw new Error(`${label} does not exist: ${path}`, {cause: error})
    }
    throw new Error(`${label} must be an exact non-symlink file: ${path}`, {cause: error})
  }
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) throw new Error(`${label} must be a file: ${path}`)
    const current = await lstat(path)
    if (!current.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new Error(`${label} changed during resolution: ${path}`)
    }
    return Object.freeze({path, handle})
  } catch (error) {
    await handle.close()
    throw error
  }
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
): StorybookPresentationGroup | null {
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
