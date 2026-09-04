import {afterEach, describe, expect, test} from "bun:test"
import {cp, link, mkdtemp, mkdir, realpath, rm, stat, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
  resolveExternalStorybookDeclarations,
  type ResolvedExternalStorybookPackage,
} from "./declarations.ts"
import {createExternalStorybookGraph, externalStorybookNode} from "./graph.ts"
import {createStorybookPackageRevisionGraphSnapshot} from "./package-revision.ts"

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
    expect(manifest.$defs.authorStyleSheet.additionalProperties).toBeFalse()
    for (const kind of [
      "widgetContributionModule",
      "standardWidgetContribution",
      "componentWidgetContribution",
      "widgetContributions",
    ]) expect(manifest.$defs[kind].additionalProperties, kind).toBeFalse()
    expect(manifest.$defs.widgetContributions.properties.items.maxItems).toBe(32)
    expect(catalog.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(catalog.additionalProperties).toBeFalse()
    for (const kind of ["category", "subject", "variant", "group", "module", "resources", "presentation"]) {
      expect(catalog.$defs[kind].additionalProperties, kind).toBeFalse()
    }
    expect(catalog.$defs.subject.required).toContain("presentation")
    expect(catalog.$defs.category.dependentRequired).toEqual({
      kind: ["apiName"],
      apiName: ["kind"],
    })
    expect(catalog.$defs.presentation.properties.widgets).toMatchObject({minItems: 2, maxItems: 32, uniqueItems: true})
    expect(catalog.$defs.presentation.properties.projection.enum).toEqual(["display", "hud", "space"])
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
    expect(components.authorStyleSheets.map(({specifier}) => specifier)).toEqual([
      "@fixture/components/tokens.css",
      "@fixture/components/theme.css",
    ])
    expect(components.authorStyleSheets.every(({path}) => path.startsWith(components.scopeRoot))).toBeTrue()
    expect(components.authorStyleSheets.every(({contentDigest}) => /^[a-f0-9]{64}$/u.test(contentDigest))).toBeTrue()
    expect(Object.isFrozen(components.authorStyleSheets)).toBeTrue()
    expect(components.widgetContributions).toMatchObject({
      protocol: "widget-contribution/1",
      items: [{id: "fixture-controls", kind: "component", label: "Fixture controls"}],
    })
    expect(components.widgetContributions?.items[0]?.kind === "component" &&
      components.widgetContributions.items[0].module).toMatchObject({exportName: "FixtureControlsWidget"})
    expect(components.catalog?.categories.map(({id}) => id)).toEqual(["foundation", "components"])
    expect(components.catalog?.categories[0]?.group).toBeNull()
    expect(components.catalog?.categories[1]?.group).toEqual({id: "ui", label: "UI"})
    const button = components.catalog?.categories[1]?.subjects[0]
    expect(button?.presentation).toEqual({
      protocol: "story-presentation/1",
      projection: "display",
      widgets: ["props", "source", "diagnostics"],
    })
    expect(button?.variants.every(({presentation}) => presentation === button.presentation)).toBeTrue()
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

  test("preserves paired semantic category identity and rejects partial metadata", async () => {
    const typed = await cloneFixture()
    await updateComponentsCatalog(typed, (catalog) => {
      const categories = asRecords(catalog.categories)
      categories[1] = {...categories[1], kind: "component", apiName: "ButtonCatalog"}
      return {...catalog, categories}
    })
    const resolved = declarationPackage(
      (await resolveExternalStorybookDeclarations([typed])).declarations,
      "@fixture/components",
    )
    expect(resolved.catalog?.categories[1]).toMatchObject({
      kind: "component",
      apiName: "ButtonCatalog",
    })
    const graph = createExternalStorybookGraph(
      await resolveExternalStorybookDeclarations([typed]),
    )
    expect(externalStorybookNode(graph, "category:@fixture/components/components")).toMatchObject({
      subjectKind: "component",
      apiName: "ButtonCatalog",
    })
    const revision = createStorybookPackageRevisionGraphSnapshot(
      graph,
      "@fixture/components",
      "typed-category",
    )
    expect(revision.nodes.find(({id}) => id === "category:@fixture/components/components"))
      .toMatchObject({subjectKind: "component", apiName: "ButtonCatalog"})

    for (const orphan of ["kind", "apiName"] as const) {
      const invalid = await cloneFixture()
      await updateComponentsCatalog(invalid, (catalog) => {
        const categories = asRecords(catalog.categories)
        categories[1] = {
          ...categories[1],
          ...(orphan === "kind" ? {kind: "component"} : {apiName: "ButtonCatalog"}),
        }
        return {...catalog, categories}
      })
      await expect(resolveExternalStorybookDeclarations([invalid]))
        .rejects.toThrow("kind and apiName must be declared together")
    }
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
      .rejects.toThrow("must be an exact non-symlink file")
  })

  test("preserves the declared owner path independently of a hardlink leaf alias", async () => {
    const hardlinked = await cloneFixture()
    const packageRoot = join(hardlinked, "projects", "alpha", "packages", "components")
    const packageJsonPath = join(packageRoot, "package.json")
    const mirrorRoot = join(hardlinked, "node_modules", ".bun", "components-mirror")
    const mirrorPath = join(mirrorRoot, "package.json")
    await mkdir(mirrorRoot, {recursive: true})
    await link(packageJsonPath, mirrorPath)

    const [ownerStat, mirrorStat, leafRealpath, canonicalPackageRoot, canonicalMirrorRoot] = await Promise.all([
      stat(packageJsonPath),
      stat(mirrorPath),
      realpath(packageJsonPath),
      realpath(packageRoot),
      realpath(mirrorRoot),
    ])
    expect({dev: ownerStat.dev, ino: ownerStat.ino}).toEqual({
      dev: mirrorStat.dev,
      ino: mirrorStat.ino,
    })
    expect([
      join(canonicalPackageRoot, "package.json"),
      join(canonicalMirrorRoot, "package.json"),
    ]).toContain(leafRealpath)

    const declarations = await resolveExternalStorybookDeclarations([hardlinked])
    const components = declarationPackage(declarations.declarations, "@fixture/components")
    expect(components.scopeRoot).toBe(canonicalPackageRoot)
    expect(components.packageJsonPath).toBe(join(canonicalPackageRoot, "package.json"))
  })

  test("resolves only exact ordered public CSS exports and digests their bytes", async () => {
    const digestRoot = await cloneFixture()
    const first = declarationPackage(
      (await resolveExternalStorybookDeclarations([digestRoot])).declarations,
      "@fixture/components",
    )
    await Bun.write(
      join(digestRoot, "projects/alpha/packages/components/tokens.css"),
      ":root { --fixture-accent: #ffffff; }\n",
    )
    const second = declarationPackage(
      (await resolveExternalStorybookDeclarations([digestRoot])).declarations,
      "@fixture/components",
    )
    expect(second.authorStyleSheets.map(({specifier}) => specifier)).toEqual(
      first.authorStyleSheets.map(({specifier}) => specifier),
    )
    expect(second.authorStyleSheets[0]?.contentDigest).not.toBe(first.authorStyleSheets[0]?.contentDigest)
    expect(second.authorStyleSheets[1]?.contentDigest).toBe(first.authorStyleSheets[1]?.contentDigest)

    const dependencyResource = await cloneFixture()
    const dependencyRoot = join(dependencyResource, "projects/alpha/packages/components")
    const consumerRoot = join(dependencyResource, "projects/beta/packages/docs")
    await updateJson(join(consumerRoot, "package.json"), (value) => ({
      ...value,
      dependencies: {"@fixture/components": "link:@fixture/components"},
    }))
    await mkdir(join(consumerRoot, "node_modules", "@fixture"), {recursive: true})
    await symlink(dependencyRoot, join(consumerRoot, "node_modules", "@fixture", "components"))
    await updateJson(join(consumerRoot, ".storybook/manifest.json"), (value) => ({
      ...value,
      authorStyleSheets: [{specifier: "@fixture/components/theme.css"}],
    }))
    const consumer = declarationPackage(
      (await resolveExternalStorybookDeclarations([dependencyResource])).declarations,
      "@fixture/docs",
    )
    const canonicalDependencyRoot = await realpath(dependencyRoot)
    expect(consumer.authorStyleSheets).toEqual([{
      specifier: "@fixture/components/theme.css",
      path: join(canonicalDependencyRoot, "theme.css"),
      ownerRoot: canonicalDependencyRoot,
      ownerPackageJsonPath: join(canonicalDependencyRoot, "package.json"),
      contentDigest: first.authorStyleSheets[1]!.contentDigest,
    }])

    const transitiveResource = await cloneFixture()
    const transitiveComponentsRoot = join(transitiveResource, "projects/alpha/packages/components")
    const transitiveThemeRoot = join(transitiveResource, "projects/alpha/packages/theme")
    const transitiveConsumerRoot = join(transitiveResource, "projects/beta/packages/docs")
    await mkdir(transitiveThemeRoot, {recursive: true})
    await Bun.write(join(transitiveThemeRoot, "package.json"), JSON.stringify({
      name: "@fixture/theme",
      type: "module",
      exports: {"./theme.css": "./theme.css"},
    }))
    await Bun.write(join(transitiveThemeRoot, "theme.css"), ":root { --transitive: #abcdef; }\n")
    await updateJson(join(transitiveComponentsRoot, "package.json"), (value) => ({
      ...value,
      dependencies: {
        ...(value.dependencies as Record<string, unknown> | undefined),
        "@fixture/theme": "link:../theme",
      },
    }))
    await updateJson(join(transitiveConsumerRoot, "package.json"), (value) => ({
      ...value,
      dependencies: {"@fixture/components": "link:@fixture/components"},
    }))
    await mkdir(join(transitiveConsumerRoot, "node_modules", "@fixture"), {recursive: true})
    await symlink(
      transitiveComponentsRoot,
      join(transitiveConsumerRoot, "node_modules", "@fixture", "components"),
    )
    await updateJson(join(transitiveConsumerRoot, ".storybook/manifest.json"), (value) => ({
      ...value,
      authorStyleSheets: [{specifier: "@fixture/theme/theme.css"}],
    }))
    const transitiveConsumer = declarationPackage(
      (await resolveExternalStorybookDeclarations([transitiveResource])).declarations,
      "@fixture/docs",
    )
    expect(transitiveConsumer.authorStyleSheets[0]).toMatchObject({
      specifier: "@fixture/theme/theme.css",
      ownerRoot: await realpath(transitiveThemeRoot),
    })

    const missingExport = await cloneFixture()
    await updateJson(componentsPackageJson(missingExport), (value) => ({
      ...value,
      exports: {"./*": "./*"},
    }))
    await expect(resolveExternalStorybookDeclarations([missingExport]))
      .rejects.toThrow("not an exact package export")

    const conditionalExport = await cloneFixture()
    await updateJson(componentsPackageJson(conditionalExport), (value) => ({
      ...value,
      exports: {
        ...value.exports as Record<string, unknown>,
        "./tokens.css": {default: "./tokens.css"},
      },
    }))
    await expect(resolveExternalStorybookDeclarations([conditionalExport]))
      .rejects.toThrow("must be a string")

    const nonCanonicalTarget = await cloneFixture()
    await updateJson(componentsPackageJson(nonCanonicalTarget), (value) => ({
      ...value,
      exports: {
        ...value.exports as Record<string, unknown>,
        "./tokens.css": "./styles/../tokens.css",
      },
    }))
    await expect(resolveExternalStorybookDeclarations([nonCanonicalTarget]))
      .rejects.toThrow("must be an exact relative file target")

    const foreignSpecifier = await cloneFixture()
    await updateJson(componentsManifest(foreignSpecifier), (value) => ({
      ...value,
      authorStyleSheets: [{specifier: "@fixture/other/theme.css"}],
    }))
    await expect(resolveExternalStorybookDeclarations([foreignSpecifier]))
      .rejects.toThrow("neither self-owned nor a manifest-reached local dependency")

    const remoteDependency = await cloneFixture()
    await updateJson(componentsPackageJson(remoteDependency), (value) => ({
      ...value,
      dependencies: {"@fixture/other": "^1.0.0"},
    }))
    await updateJson(componentsManifest(remoteDependency), (value) => ({
      ...value,
      authorStyleSheets: [{specifier: "@fixture/other/theme.css"}],
    }))
    await expect(resolveExternalStorybookDeclarations([remoteDependency]))
      .rejects.toThrow("dependency must be local")

    const duplicateSpecifier = await cloneFixture()
    await updateJson(componentsManifest(duplicateSpecifier), (value) => ({
      ...value,
      authorStyleSheets: [
        {specifier: "@fixture/components/theme.css"},
        {specifier: "@fixture/components/theme.css"},
      ],
    }))
    await expect(resolveExternalStorybookDeclarations([duplicateSpecifier]))
      .rejects.toThrow("Duplicate external Storybook author stylesheet specifier")

    const compatibilityShape = await cloneFixture()
    await updateJson(componentsManifest(compatibilityShape), (value) => ({
      ...value,
      authorStyleSheets: [{id: "@fixture/components/theme.css", path: "../theme.css"}],
    }))
    await expect(resolveExternalStorybookDeclarations([compatibilityShape]))
      .rejects.toThrow("unknown field: id")

    const symlinkEscape = await cloneFixture()
    const packageRoot = join(symlinkEscape, "projects/alpha/packages/components")
    const outside = join(symlinkEscape, "outside.css")
    await Bun.write(outside, "body { color: red; }\n")
    await symlink(outside, join(packageRoot, "escape.css"))
    await updateJson(componentsPackageJson(symlinkEscape), (value) => ({
      ...value,
      exports: {
        ...value.exports as Record<string, unknown>,
        "./theme.css": "./escape.css",
      },
    }))
    await expect(resolveExternalStorybookDeclarations([symlinkEscape]))
      .rejects.toThrow("must be an exact non-symlink file")
  })

  test("validates the exact widget registry and subject-owned presentation", async () => {
    const standardItems = [
      "props", "source", "events", "diagnostics", "dom", "layout", "display", "reference",
    ].map((id) => ({id, kind: "standard" as const}))
    const self = await cloneFixture()
    await updateJson(componentsManifest(self), (value) => ({
      ...value,
      id: "@zavx0z/storybook",
      authorStyleSheets: undefined,
      widgetContributions: {
        protocol: "widget-contribution/1",
        items: [
          ...standardItems,
          {
            id: "fixture-controls",
            kind: "component",
            label: "Fixture controls",
            module: {path: "./widgets/fixture-controls.tsx", export: "FixtureControlsWidget"},
          },
        ],
      },
    }))
    await updateJson(componentsPackageJson(self), (value) => ({...value, name: "@zavx0z/storybook"}))
    const selfPackage = declarationPackage(
      (await resolveExternalStorybookDeclarations([self])).declarations,
      "@zavx0z/storybook",
    )
    expect(selfPackage.widgetContributions?.items
      .filter(({kind}) => kind === "standard")
      .map(({id, kind}) => ({id, kind}))).toEqual(standardItems)

    const selfWithoutRegistry = await cloneFixture()
    await updateJson(componentsManifest(selfWithoutRegistry), (value) => ({
      ...value,
      id: "@zavx0z/storybook",
      authorStyleSheets: undefined,
      widgetContributions: undefined,
    }))
    await updateJson(
      componentsPackageJson(selfWithoutRegistry),
      (value) => ({...value, name: "@zavx0z/storybook"}),
    )
    await expect(resolveExternalStorybookDeclarations([selfWithoutRegistry]))
      .rejects.toThrow("must declare widget-contribution/1 standard registry")

    const ordinaryStandard = await cloneFixture()
    await updateJson(componentsManifest(ordinaryStandard), (value) => ({
      ...value,
      widgetContributions: {protocol: "widget-contribution/1", items: [standardItems[0]]},
    }))
    await expect(resolveExternalStorybookDeclarations([ordinaryStandard]))
      .rejects.toThrow("can only be declared by @zavx0z/storybook")

    const reservedComponent = await cloneFixture()
    await updateJson(componentsManifest(reservedComponent), (value) => ({
      ...value,
      widgetContributions: {
        protocol: "widget-contribution/1",
        items: [{
          id: "source",
          kind: "component",
          label: "Wrong",
          module: {path: "./stories/button.ts", export: "contained"},
        }],
      },
    }))
    await expect(resolveExternalStorybookDeclarations([reservedComponent]))
      .rejects.toThrow("reserved by the standard registry")

    const tooMany = await cloneFixture()
    await updateJson(componentsManifest(tooMany), (value) => ({
      ...value,
      widgetContributions: {
        protocol: "widget-contribution/1",
        items: Array.from({length: 33}, (_unused, index) => ({
          id: `widget-${index}`,
          kind: "component",
          label: `Widget ${index}`,
          module: {path: "./stories/button.ts", export: "contained"},
        })),
      },
    }))
    await expect(resolveExternalStorybookDeclarations([tooMany]))
      .rejects.toThrow("at most 32 entries")

    const missingWidgetExport = await cloneFixture()
    await updateJson(componentsManifest(missingWidgetExport), (value) => ({
      ...value,
      widgetContributions: {
        protocol: "widget-contribution/1",
        items: [{
          id: "custom",
          kind: "component",
          label: "Custom",
          module: {path: "./stories/button.ts", export: "missing"},
        }],
      },
    }))
    await expect(resolveExternalStorybookDeclarations([missingWidgetExport]))
      .rejects.toThrow("module has no export missing")

    const duplicate = await cloneFixture()
    await updateJson(componentsManifest(duplicate), (value) => ({
      ...value,
      widgetContributions: {
        protocol: "widget-contribution/1",
        items: [
          {
            id: "custom", kind: "component", label: "One",
            module: {path: "./stories/button.ts", export: "contained"},
          },
          {
            id: "custom", kind: "component", label: "Two",
            module: {path: "./stories/button.ts", export: "outlined"},
          },
        ],
      },
    }))
    await expect(resolveExternalStorybookDeclarations([duplicate]))
      .rejects.toThrow("Duplicate external Storybook widget contribution id")

    const missingPresentation = await cloneFixture()
    await updateComponentsCatalog(missingPresentation, (catalog) => {
      const categories = asRecords(catalog.categories)
      const subjects = asRecords(categories[0]!.subjects)
      const {presentation: _removed, ...subject} = subjects[0]!
      categories[0] = {...categories[0], subjects: [subject]}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([missingPresentation]))
      .rejects.toThrow("is missing field: presentation")

    const unknownWidget = await cloneFixture()
    await updateComponentsCatalog(unknownWidget, (catalog) => {
      const categories = asRecords(catalog.categories)
      const subjects = asRecords(categories[0]!.subjects)
      subjects[0] = {
        ...subjects[0],
        presentation: {protocol: "story-presentation/1", projection: "space", widgets: ["source", "diagnostics", "missing"]},
      }
      categories[0] = {...categories[0], subjects}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([unknownWidget]))
      .rejects.toThrow("Unknown external Storybook presentation widget")

    const missingDiagnostic = await cloneFixture()
    await updateComponentsCatalog(missingDiagnostic, (catalog) => {
      const categories = asRecords(catalog.categories)
      const subjects = asRecords(categories[0]!.subjects)
      subjects[0] = {
        ...subjects[0],
        presentation: {protocol: "story-presentation/1", projection: "hud", widgets: ["source", "props"]},
      }
      categories[0] = {...categories[0], subjects}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([missingDiagnostic]))
      .rejects.toThrow("widgets must contain diagnostics")

    const duplicateWidget = await cloneFixture()
    await updateComponentsCatalog(duplicateWidget, (catalog) => {
      const categories = asRecords(catalog.categories)
      const subjects = asRecords(categories[0]!.subjects)
      subjects[0] = {
        ...subjects[0],
        presentation: {protocol: "story-presentation/1", projection: "space", widgets: ["source", "diagnostics", "source"]},
      }
      categories[0] = {...categories[0], subjects}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([duplicateWidget]))
      .rejects.toThrow("widgets must not contain duplicates")

    const legacyWorld = await cloneFixture()
    await updateComponentsCatalog(legacyWorld, (catalog) => {
      const categories = asRecords(catalog.categories)
      const subjects = asRecords(categories[0]!.subjects)
      subjects[0] = {
        ...subjects[0],
        presentation: {
          protocol: "story-presentation/1",
          projection: "world",
          widgets: ["source", "diagnostics"],
        },
      }
      categories[0] = {...categories[0], subjects}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([legacyWorld]))
      .rejects.toThrow("Unsupported external Storybook presentation projection")

    const variantDefault = await cloneFixture()
    await updateComponentsCatalog(variantDefault, (catalog) => {
      const categories = asRecords(catalog.categories)
      const subjects = asRecords(categories[1]!.subjects)
      const variants = asRecords(subjects[0]!.variants)
      variants[0] = {
        ...variants[0],
        presentation: {protocol: "story-presentation/1", projection: "hud", widgets: ["source", "diagnostics"]},
      }
      subjects[0] = {...subjects[0], variants}
      categories[1] = {...categories[1], subjects}
      return {...catalog, categories}
    })
    await expect(resolveExternalStorybookDeclarations([variantDefault]))
      .rejects.toThrow("unknown field: presentation")
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

function componentsManifest(root: string): string {
  return join(root, "projects/alpha/packages/components/.storybook/manifest.json")
}

function componentsPackageJson(root: string): string {
  return join(root, "projects/alpha/packages/components/package.json")
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
