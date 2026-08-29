import {afterEach, describe, expect, test} from "bun:test"
import {cp, mkdtemp, mkdir, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
  resolveExternalStorybookDeclarations,
  type ResolvedExternalStorybookPackage,
} from "./declarations.ts"

const fixtureRoot = join(import.meta.dir, "fixtures", "valid")
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

describe("external Storybook JSON declarations", () => {
  test("ships one strict versioned schema for manifests and catalogs", async () => {
    const manifest = await Bun.file(join(import.meta.dir, "..", "..", "schemas", "manifest.schema.json")).json()
    const catalog = await Bun.file(join(import.meta.dir, "..", "..", "schemas", "catalog.schema.json")).json()

    expect(manifest.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(manifest.oneOf).toHaveLength(3)
    for (const kind of ["workspace", "project", "package"]) {
      expect(manifest.$defs[kind].additionalProperties, kind).toBeFalse()
      expect(manifest.$defs[kind].properties.schemaVersion).toEqual({const: 1})
    }
    expect(catalog.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(catalog.additionalProperties).toBeFalse()
    for (const kind of ["category", "subject", "variant", "group", "module", "resources"]) {
      expect(catalog.$defs[kind].additionalProperties, kind).toBeFalse()
    }
    expect(catalog.properties.schemaVersion).toEqual({const: 1})
    expect(JSON.stringify([manifest, catalog])).not.toContain("function")
  })

  test("resolves a workspace and independent package through canonical owner paths", async () => {
    const resolved = await resolveExternalStorybookDeclarations([
      fixtureRoot,
      join(fixtureRoot, "standalone", ".storybook", "manifest.json"),
    ])

    expect(resolved.schemaVersion).toBe(EXTERNAL_STORYBOOK_SCHEMA_VERSION)
    expect(resolved.rootIds).toEqual([
      "workspace:fixture-workspace",
      "package:@fixture/standalone",
    ])
    expect(resolved.declarations).toHaveLength(6)
    expect(Object.isFrozen(resolved)).toBeTrue()
    expect(Object.isFrozen(resolved.declarations)).toBeTrue()

    const components = declarationPackage(resolved.declarations, "@fixture/components")
    expect(components.packageName).toBe("@fixture/components")
    expect(components.packageJsonPath).toEndWith("/projects/alpha/packages/components/package.json")
    expect(components.runtime).toMatchObject({exportName: "runtime"})
    expect(components.catalog?.categories.map(({id}) => id)).toEqual(["foundation", "components"])
    expect(components.catalog?.categories[0]?.group).toBeNull()
    expect(components.catalog?.categories[1]?.group).toEqual({id: "ui", label: "UI"})
    expect(components.catalog?.categories[0]?.subjects[0]?.variants).toEqual([])
    const contained = components.catalog?.categories[1]?.subjects[0]?.variants[0]
    expect(contained?.route).toBe("components/button/basic/contained")
    expect(contained?.module?.exportName).toBe("contained")
    expect(contained?.resources.map(({kind}) => kind)).toEqual([
      "fixture",
      "test",
      "reference",
      "asset",
    ])
    expect(contained?.resources.every(({path}) => path.startsWith(components.scopeRoot))).toBeTrue()
    expect(Object.isFrozen(components.catalog?.categories)).toBeTrue()
    expect(Object.isFrozen(contained?.resources)).toBeTrue()
    expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved)
  })

  test("treats standalone, one-package and multi-package composition as the same resolver input", async () => {
    const root = await cloneFixture()
    const alphaRoot = join(root, "projects", "alpha")
    const extraRoot = join(alphaRoot, "packages", "extra-docs")
    await cp(join(root, "projects", "beta", "packages", "docs"), extraRoot, {recursive: true})
    await updateJson(join(extraRoot, "package.json"), (value) => ({...value, name: "@fixture/extra-docs"}))
    await updateJson(join(extraRoot, ".storybook", "manifest.json"), (value) => ({
      ...value,
      id: "@fixture/extra-docs",
      label: "Extra Docs",
    }))
    await updateJson(join(alphaRoot, ".storybook", "manifest.json"), (value) => ({
      ...value,
      packages: [
        ...asRecords(value.packages),
        {declaration: "../packages/extra-docs/.storybook/manifest.json"},
      ],
    }))

    const resolved = await resolveExternalStorybookDeclarations([
      alphaRoot,
      join(root, "standalone"),
    ])
    expect(resolved.rootIds).toEqual([
      "project:fixture-alpha",
      "package:@fixture/standalone",
    ])
    const project = resolved.declarations.find(({canonicalId}) => canonicalId === "project:fixture-alpha")
    expect(project?.kind).toBe("project")
    if (project?.kind !== "project") throw new Error("Fixture project is missing")
    expect(project.packageIds).toEqual([
      "package:@fixture/components",
      "package:@fixture/extra-docs",
    ])
  })

  test("fails closed for unknown versions, kinds, fields and missing declarations", async () => {
    const unknownVersion = await cloneFixture()
    await updateJson(manifest(unknownVersion), (value) => ({...value, schemaVersion: 2}))
    await expect(resolveExternalStorybookDeclarations([unknownVersion]))
      .rejects.toThrow("Unsupported external Storybook manifest schemaVersion")

    const unknownKind = await cloneFixture()
    await updateJson(manifest(unknownKind), (value) => ({...value, kind: "galaxy"}))
    await expect(resolveExternalStorybookDeclarations([unknownKind]))
      .rejects.toThrow("Unknown external Storybook manifest kind")

    const unknownField = await cloneFixture()
    await updateJson(manifest(unknownField), (value) => ({...value, loader: "./code.ts"}))
    await expect(resolveExternalStorybookDeclarations([unknownField]))
      .rejects.toThrow("unknown field: loader")

    const missing = await cloneFixture()
    await updateJson(manifest(missing), (value) => ({
      ...value,
      projects: [{declaration: "../missing/.storybook/manifest.json"}],
    }))
    await expect(resolveExternalStorybookDeclarations([missing]))
      .rejects.toThrow("does not exist")
  })

  test("rejects cycles, duplicate scope ids and ambiguous package identities", async () => {
    const cyclic = await cloneFixture()
    await updateJson(manifest(cyclic), (value) => ({
      ...value,
      projects: [{declaration: "./manifest.json"}],
    }))
    await expect(resolveExternalStorybookDeclarations([cyclic]))
      .rejects.toThrow("Cyclic external Storybook declarations")

    const duplicateProject = await cloneFixture()
    const alpha = join(duplicateProject, "projects", "alpha")
    const duplicate = join(duplicateProject, "projects", "duplicate")
    await cp(alpha, duplicate, {recursive: true})
    await updateJson(manifest(duplicateProject), (value) => ({
      ...value,
      projects: [
        ...asRecords(value.projects),
        {declaration: "../projects/duplicate/.storybook/manifest.json"},
      ],
    }))
    await expect(resolveExternalStorybookDeclarations([duplicateProject]))
      .rejects.toThrow("Duplicate external Storybook scope id fixture-alpha")

    const ambiguousPackage = await cloneFixture()
    const components = join(ambiguousPackage, "projects", "alpha", "packages", "components")
    const duplicateComponents = join(ambiguousPackage, "projects", "alpha", "packages", "duplicate-components")
    await cp(components, duplicateComponents, {recursive: true})
    await updateJson(join(ambiguousPackage, "projects", "alpha", ".storybook", "manifest.json"), (value) => ({
      ...value,
      packages: [
        ...asRecords(value.packages),
        {declaration: "../packages/duplicate-components/.storybook/manifest.json"},
      ],
    }))
    await expect(resolveExternalStorybookDeclarations([ambiguousPackage]))
      .rejects.toThrow("Ambiguous external Storybook package identity @fixture/components")
  })

  test("enforces package identity, containment and symlink-safe realpaths", async () => {
    const identity = await cloneFixture()
    const packageJson = join(identity, "projects", "alpha", "packages", "components", "package.json")
    await updateJson(packageJson, (value) => ({...value, name: "@fixture/other"}))
    await expect(resolveExternalStorybookDeclarations([identity]))
      .rejects.toThrow("does not match package.json name")

    const lexicalEscape = await cloneFixture()
    const packageManifest = join(
      lexicalEscape,
      "projects",
      "alpha",
      "packages",
      "components",
      ".storybook",
      "manifest.json",
    )
    await updateJson(packageManifest, (value) => ({...value, readme: "../../../../../../README.md"}))
    await expect(resolveExternalStorybookDeclarations([lexicalEscape]))
      .rejects.toThrow("escapes scope root")

    const symlinkEscape = await cloneFixture()
    const outside = join(dirname(symlinkEscape), "outside.md")
    await Bun.write(outside, "outside")
    const packageRoot = join(symlinkEscape, "projects", "alpha", "packages", "components")
    const link = join(packageRoot, ".storybook", "outside.md")
    await symlink(outside, link)
    const catalog = join(packageRoot, ".storybook", "catalog.json")
    await updateJson(catalog, (value) => {
      const categories = asRecords(value.categories)
      const foundation = categories[0]!
      const subjects = asRecords(foundation.subjects)
      subjects[0] = {...subjects[0], readme: "./outside.md"}
      categories[0] = {...foundation, subjects}
      return {...value, categories}
    })
    await expect(resolveExternalStorybookDeclarations([symlinkEscape]))
      .rejects.toThrow("escapes scope root after realpath")
  })

  test("rejects missing exports, duplicate routes and conflicting group descriptors", async () => {
    const runtimeAlias = await cloneFixture()
    const runtimeManifest = join(
      runtimeAlias,
      "projects/alpha/packages/components/.storybook/manifest.json",
    )
    await updateJson(runtimeManifest, (value) => ({
      ...value,
      runtime: {path: "./runtime.ts", export: "runtime"},
    }))
    await expect(resolveExternalStorybookDeclarations([runtimeAlias]))
      .rejects.toThrow("unknown field: path")

    const moduleAlias = await cloneFixture()
    await updateComponentsCatalog(moduleAlias, (catalog) => {
      const categories = asRecords(catalog.categories)
      const components = categories[1]!
      const subjects = asRecords(components.subjects)
      const button = subjects[0]!
      const variants = asRecords(button.variants)
      variants[0] = {
        ...variants[0],
        module: {module: "./stories/button.ts", export: "contained"},
      }
      subjects[0] = {...button, variants}
      categories[1] = {...components, subjects}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([moduleAlias]))
      .rejects.toThrow("unknown field: module")

    const missingExport = await cloneFixture()
    await updateComponentsCatalog(missingExport, (catalog) => {
      const categories = asRecords(catalog.categories)
      const components = categories[1]!
      const subjects = asRecords(components.subjects)
      const button = subjects[0]!
      const variants = asRecords(button.variants)
      variants[0] = {...variants[0], module: {path: "./stories/button.ts", export: "missing"}}
      subjects[0] = {...button, variants}
      categories[1] = {...components, subjects}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([missingExport]))
      .rejects.toThrow("module has no export missing")

    const duplicateRoute = await cloneFixture()
    await updateComponentsCatalog(duplicateRoute, (catalog) => {
      const categories = asRecords(catalog.categories)
      const components = categories[1]!
      const subjects = asRecords(components.subjects)
      const button = subjects[0]!
      const variants = asRecords(button.variants)
      variants[1] = {...variants[1], route: "components/button/basic/contained"}
      subjects[0] = {...button, variants}
      categories[1] = {...components, subjects}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([duplicateRoute]))
      .rejects.toThrow("Duplicate external Storybook route")

    const leafPrefix = await cloneFixture()
    await updateComponentsCatalog(leafPrefix, (catalog) => {
      const categories = asRecords(catalog.categories)
      categories[0] = {...categories[0], route: "components/button/basic/contained/overview"}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([leafPrefix]))
      .rejects.toThrow("leaf route cannot contain another route")

    const groupConflict = await cloneFixture()
    await updateComponentsCatalog(groupConflict, (catalog) => {
      const categories = asRecords(catalog.categories)
      const components = categories[1]!
      const subjects = asRecords(components.subjects)
      const button = subjects[0]!
      const variants = asRecords(button.variants)
      variants[1] = {...variants[1], group: {id: "basic", label: "Other"}}
      subjects[0] = {...button, variants}
      categories[1] = {...components, subjects}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([groupConflict]))
      .rejects.toThrow("Conflicting external Storybook group label")
  })
})

function declarationPackage(
  declarations: readonly unknown[],
  id: string,
): ResolvedExternalStorybookPackage {
  const declaration = declarations.find((candidate) => (
    typeof candidate === "object" && candidate !== null &&
    "kind" in candidate && candidate.kind === "package" &&
    "id" in candidate && candidate.id === id
  ))
  if (declaration === undefined) throw new Error(`Fixture package is missing: ${id}`)
  return declaration as ResolvedExternalStorybookPackage
}

async function cloneFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "external-storybook-declarations-"))
  temporaryRoots.push(root)
  const target = join(root, "fixture")
  await cp(fixtureRoot, target, {recursive: true})
  return target
}

function manifest(root: string): string {
  return join(root, ".storybook", "manifest.json")
}

async function updateComponentsCatalog(
  root: string,
  update: (value: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const path = join(
    root,
    "projects",
    "alpha",
    "packages",
    "components",
    ".storybook",
    "catalog.json",
  )
  await updateJson(path, update)
}

async function updateJson(
  path: string,
  update: (value: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), {recursive: true})
  const value = await Bun.file(path).json() as Record<string, unknown>
  await Bun.write(path, `${JSON.stringify(update(value), null, 2)}\n`)
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Fixture value must be an array")
  return value.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Fixture entry must be an object")
    }
    return {...entry as Record<string, unknown>}
  })
}
