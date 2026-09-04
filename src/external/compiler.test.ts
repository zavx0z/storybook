import {afterEach, describe, expect, setDefaultTimeout, test} from "bun:test"
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join, resolve} from "node:path"
import {
  createStorybookPackageCompilerPlugins,
  resolveStorybookCompilerSourceRoots,
} from "./compiler.ts"

const temporaryRoots: string[] = []
setDefaultTimeout(20_000)

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})))
})

describe("external Storybook package compiler", () => {
  test("keeps exact owner resolution when effective tsconfig does not require Template JSX", async () => {
    const root = await temporaryRoot()
    await writeJson(join(root, "package.json"), {name: "@fixture/plain"})
    await writeJson(join(root, "tsconfig.json"), {
      compilerOptions: {jsx: "react-jsx", jsxImportSource: "react"},
    })
    const source = join(root, "story.tsx")
    await Bun.write(source, "export const story = <div />")

    const plugins = await createStorybookPackageCompilerPlugins({
      packageRoot: root,
      projectRoot: root,
      moduleSourcePaths: [source],
    })

    expect(plugins.map(({name}) => name)).toEqual([
      "external-storybook-exact-owner-resolution",
      "zavx0z-template-jsx",
    ])
    expect(Object.isFrozen(plugins)).toBeTrue()
  })

  test("skips a foreign ambient cache and resolves the exact attested tool owner", async () => {
    const root = await temporaryRoot()
    const foreignTemplate = join(root, "node_modules", "@zavx0z", "template")
    await mkdir(foreignTemplate, {recursive: true})
    await writeJson(join(root, "package.json"), {name: "@fixture/foreign-cache"})
    await writeJson(join(root, "tsconfig.json"), {
      compilerOptions: {jsx: "react-jsx", jsxImportSource: "react"},
    })
    await writeJson(join(foreignTemplate, "package.json"), {
      name: "@zavx0z/template",
      exports: {"./compiled": "./compiled.ts"},
    })
    await Bun.write(join(foreignTemplate, "compiled.ts"), "export const foreign = true\n")
    const source = join(root, "story.ts")
    await Bun.write(source, "export const story = true\n")

    const plugins = await createStorybookPackageCompilerPlugins({
      packageRoot: root,
      projectRoot: root,
      moduleSourcePaths: [source],
    })
    const resolved = resolveWithPlugin(plugins[0]!, "@zavx0z/template/compiled")
    expect(resolved.path).toBe(await realpath(resolve(
      import.meta.dir,
      "../../../webxr-space/template/compiled.ts",
    )))
  })

  test("resolves a fresh Template plugin and exact manifest-reached source roots", async () => {
    const fixture = await templateProjectFixture()
    const first = await createStorybookPackageCompilerPlugins(fixture.input)
    const second = await createStorybookPackageCompilerPlugins(fixture.input)

    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)
    expect(first[0]).not.toBe(second[0])
    expect(first[1]).not.toBe(second[1])
    expect(first.map(({name}) => name)).toEqual([
      "external-storybook-exact-owner-resolution",
      "zavx0z-template-jsx",
    ])
    expect(second.map(({name}) => name)).toEqual([
      "external-storybook-exact-owner-resolution",
      "zavx0z-template-jsx",
    ])
    const canonicalProjectRoot = await realpath(fixture.projectRoot)
    const canonicalDependencyRoots = await Promise.all([
      fixture.linkedRoot,
      fixture.templateRoot,
      fixture.transitiveRoot,
    ].map(async (path) => await realpath(path)))
    const expectedOwnerSourceRoots = [
      canonicalProjectRoot,
      ...canonicalDependencyRoots.sort(),
      await realpath(fixture.packageRoot),
    ]
    const ownerSourceRoots = resolveStorybookCompilerSourceRoots({
      projectRoot: fixture.projectRoot,
      packageRoot: fixture.packageRoot,
    })
    for (const root of expectedOwnerSourceRoots) expect(ownerSourceRoots).toContain(root)
  })

  test("reads JSONC extends and fails closed for conflicting module configs", async () => {
    const fixture = await templateProjectFixture()
    const nestedRoot = join(fixture.packageRoot, "nested")
    await mkdir(nestedRoot, {recursive: true})
    await writeJson(join(nestedRoot, "tsconfig.json"), {
      compilerOptions: {jsxImportSource: "react"},
    })
    const nestedSource = join(nestedRoot, "nested.tsx")
    await Bun.write(nestedSource, "export const nested = <div />")

    const privateOnly = await createStorybookPackageCompilerPlugins({
      ...fixture.input,
      moduleSourcePaths: [nestedSource],
    })
    expect(privateOnly.map(({name}) => name)).toEqual([
      "external-storybook-exact-owner-resolution",
      "zavx0z-template-jsx",
    ])

    await expect(createStorybookPackageCompilerPlugins({
      ...fixture.input,
      moduleSourcePaths: [...fixture.input.moduleSourcePaths, nestedSource],
    })).rejects.toThrow("conflicting jsxImportSource")
  })

  test("fails closed when Template is not a declared linked owner dependency", async () => {
    const root = await temporaryRoot()
    await writeJson(join(root, "package.json"), {name: "@fixture/missing-template"})
    await writeJson(join(root, "tsconfig.json"), {
      compilerOptions: {jsxImportSource: "@zavx0z/template"},
    })
    const source = join(root, "story.tsx")
    await Bun.write(source, "export const story = <Component />")

    await expect(createStorybookPackageCompilerPlugins({
      packageRoot: root,
      projectRoot: root,
      moduleSourcePaths: [source],
    })).rejects.toThrow("not a linked owner dependency")
  })

  test("uses the shared Storybook compiler owner for a declaration-only package like Engine", async () => {
    const root = await temporaryRoot()
    const packageRoot = join(root, "engine")
    await mkdir(packageRoot, {recursive: true})
    await writeJson(join(root, "package.json"), {name: "@fixture/project"})
    await writeJson(join(root, "tsconfig.json"), {
      compilerOptions: {jsxImportSource: "@zavx0z/template"},
    })
    await writeJson(join(packageRoot, "package.json"), {name: "@fixture/declaration-only-engine"})

    const plugins = await createStorybookPackageCompilerPlugins({
      packageRoot,
      projectRoot: root,
      moduleSourcePaths: [],
    })

    expect(plugins.map(({name}) => name)).toEqual([
      "external-storybook-exact-owner-resolution",
      "zavx0z-template-jsx",
    ])
  })

  test("builds the real webxr UI with exact tool owners satisfying declared peers", async () => {
    const projectRoot = await realpath(resolve(import.meta.dir, "../../../webxr-space"))
    const packageRoot = join(projectRoot, "ui")
    const source = join(
      packageRoot,
      ".storybook/stories/compiled/compiled-button-production-story.tsx",
    )
    const plugins = await createStorybookPackageCompilerPlugins({
      packageRoot,
      projectRoot,
      moduleSourcePaths: [source],
    })
    const result = await Bun.build({
      entrypoints: [source],
      format: "esm",
      metafile: true,
      plugins: [...plugins],
      target: "browser",
    })
    expect(result.success, result.logs.map(({message}) => message).join("\n")).toBeTrue()
    const inputs = JSON.stringify(result.metafile?.inputs ?? {})
    expect(inputs).toContain("webxr-space/ui/buttons/button.tsx")
    expect(inputs).toContain("webxr-space/component/src/index.ts")
    expect(inputs).toContain("webxr-space/template/compiled.ts")
    expect(inputs).not.toContain("node_modules/.bun/@zavx0z+")
  })

  test("maps an exact Bun hardlink module mirror back to the declared package owner", async () => {
    const projectRoot = await realpath(resolve(import.meta.dir, "../../../webxr-space"))
    const packageRoot = join(projectRoot, "ui")
    const mirrorSource = resolve(
      import.meta.dir,
      "../../node_modules/@zavx0z/ui/.storybook/stories/subjects/components-fields-toggle-button-group.ts",
    )

    const plugins = await createStorybookPackageCompilerPlugins({
      packageRoot,
      projectRoot,
      moduleSourcePaths: [mirrorSource],
    })

    expect(plugins.map(({name}) => name)).toEqual([
      "external-storybook-exact-owner-resolution",
      "zavx0z-template-jsx",
    ])
  })

  test("limits exact owner resolution to governed ids while d3-dag re-exports d3-array", async () => {
    const fixture = await d3ReExportFixture()
    const inspected = await createStorybookPackageCompilerPlugins(fixture.input)
    const filter = resolverFilter(inspected[0]!)

    expect(filter.test("@fixture/governed.test")).toBeTrue()
    expect(filter.test("@fixture/governed.test/subpath")).toBeTrue()
    expect(filter.test("@fixture/governedXtest")).toBeFalse()
    expect(filter.test("d3-dag")).toBeFalse()
    expect(filter.test("d3-array")).toBeFalse()

    const plugins = await createStorybookPackageCompilerPlugins(fixture.input)
    const result = await Bun.build({
      entrypoints: [fixture.source],
      target: "browser",
      format: "esm",
      plugins: [...plugins],
    })
    expect(result.success, result.logs.map(({message}) => message).join("\n")).toBeTrue()
    const output = result.outputs[0]
    if (output === undefined) throw new Error("d3 re-export regression build emitted no output")
    const bundled = await output.text()
    expect(bundled).not.toMatch(/from\s*["']d3-array["']/u)
    const namespace = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`)
    expect(namespace.governedMarker).toBe("governed-owner")
    expect(namespace.default21()).toBe("d3-array-default")
    expect(namespace.ascending(1, 2)).toBe(-1)
  })

  test("fails closed when consumer and tool graphs name different Template roots", async () => {
    const fixture = await templateProjectFixture(String.raw`
export function createTemplateJsxBunPlugin() {
  return {name: "alternate-template", setup() {}}
}
`)
    await expect(createStorybookPackageCompilerPlugins(fixture.input)).rejects.toThrow(
      "Ambiguous owner dependency identity @zavx0z/template",
    )
  })

  test("rejects package and module paths outside their project boundary", async () => {
    const projectRoot = await temporaryRoot()
    const foreignRoot = await temporaryRoot()
    await writeJson(join(projectRoot, "package.json"), {name: "@fixture/project"})
    await writeJson(join(foreignRoot, "package.json"), {name: "@fixture/foreign"})
    const foreignSource = join(foreignRoot, "story.ts")
    await Bun.write(foreignSource, "export const story = true")

    await expect(createStorybookPackageCompilerPlugins({
      packageRoot: foreignRoot,
      projectRoot,
      moduleSourcePaths: [foreignSource],
    })).rejects.toThrow("package root must be inside project root")
    await expect(createStorybookPackageCompilerPlugins({
      packageRoot: projectRoot,
      projectRoot,
      moduleSourcePaths: [foreignSource],
    })).rejects.toThrow("module source must be inside project root")
  })
})

async function templateProjectFixture(adapterSource?: string): Promise<Readonly<{
  projectRoot: string
  packageRoot: string
  templateRoot: string
  linkedRoot: string
  transitiveRoot: string
  input: Parameters<typeof createStorybookPackageCompilerPlugins>[0]
}>> {
  const root = await temporaryRoot()
  const projectRoot = join(root, "project")
  const packageRoot = join(projectRoot, "packages", "owner")
  const templateRoot = adapterSource === undefined
    ? await realpath(resolve(import.meta.dir, "../../../webxr-space/template"))
    : join(root, "owners", "template")
  const linkedRoot = join(root, "owners", "linked")
  const transitiveRoot = join(root, "owners", "transitive")
  await Promise.all([
    projectRoot,
    packageRoot,
    ...(adapterSource === undefined ? [] : [templateRoot]),
    linkedRoot,
    transitiveRoot,
  ]
    .map((path) => mkdir(path, {recursive: true})))

  await writeJson(join(projectRoot, "package.json"), {
    name: "@fixture/project",
    workspaces: ["packages/*"],
    dependencies: {
      "@fixture/owner": "workspace:*",
      "@fixture/linked": "link:@fixture/linked",
    },
    devDependencies: {"@zavx0z/template": `file:${templateRoot}`},
  })
  await writeJson(join(packageRoot, "package.json"), {name: "@fixture/owner"})
  if (adapterSource !== undefined) {
    await writeJson(join(templateRoot, "package.json"), {
      name: "@zavx0z/template",
      type: "module",
      exports: {"./bun": "./bun.js"},
    })
    await Bun.write(join(templateRoot, "bun.js"), adapterSource)
  }
  await writeJson(join(linkedRoot, "package.json"), {
    name: "@fixture/linked",
    dependencies: {"@fixture/transitive": "link:@fixture/transitive"},
  })
  await writeJson(join(transitiveRoot, "package.json"), {name: "@fixture/transitive"})

  await linkPackage(projectRoot, "@fixture/owner", packageRoot)
  await linkPackage(projectRoot, "@fixture/linked", linkedRoot)
  await linkPackage(projectRoot, "@zavx0z/template", templateRoot)
  await linkPackage(linkedRoot, "@fixture/transitive", transitiveRoot)

  await Bun.write(join(projectRoot, "tsconfig.base.json"), String.raw`{
    // The owner compiler setting may come from an existing JSONC base.
    "compilerOptions": {"jsxImportSource": "@zavx0z/template"}
  }`)
  await writeJson(join(projectRoot, "tsconfig.json"), {extends: "./tsconfig.base.json"})
  const source = join(packageRoot, "story.tsx")
  await Bun.write(source, "export const story = <Component />")

  return Object.freeze({
    projectRoot,
    packageRoot,
    templateRoot,
    linkedRoot,
    transitiveRoot,
    input: Object.freeze({
      packageRoot,
      projectRoot,
      moduleSourcePaths: Object.freeze([source]),
    }),
  })
}

async function d3ReExportFixture(): Promise<Readonly<{
  source: string
  input: Parameters<typeof createStorybookPackageCompilerPlugins>[0]
}>> {
  const root = await temporaryRoot()
  const projectRoot = join(root, "project")
  const packageRoot = join(projectRoot, "packages", "owner")
  const governedRoot = join(root, "governed")
  const d3DagRoot = join(packageRoot, "node_modules", "d3-dag")
  const d3ArrayRoot = join(packageRoot, "node_modules", "d3-array")
  await Promise.all([projectRoot, packageRoot, governedRoot, d3DagRoot, d3ArrayRoot]
    .map((path) => mkdir(path, {recursive: true})))

  await writeJson(join(projectRoot, "package.json"), {
    name: "@fixture/d3-project",
    workspaces: ["packages/*"],
  })
  await writeJson(join(packageRoot, "package.json"), {
    name: "@fixture/d3-owner",
    dependencies: {
      "@fixture/governed.test": "link:@fixture/governed.test",
      "d3-dag": "0.9.1",
    },
  })
  await writeJson(join(governedRoot, "package.json"), {
    name: "@fixture/governed.test",
    type: "module",
    exports: {".": "./index.js"},
  })
  await Bun.write(join(governedRoot, "index.js"),
    'export const governedMarker = "governed-owner"\n')
  await linkPackage(packageRoot, "@fixture/governed.test", governedRoot)

  await writeJson(join(d3DagRoot, "package.json"), {
    name: "d3-dag",
    type: "module",
    exports: {".": "./index.js"},
    dependencies: {"d3-array": "3.2.4"},
  })
  await Bun.write(join(d3DagRoot, "index.js"),
    'export {default as default21, ascending} from "d3-array"\n')
  await writeJson(join(d3ArrayRoot, "package.json"), {
    name: "d3-array",
    type: "module",
    exports: {".": "./index.js"},
  })
  await Bun.write(join(d3ArrayRoot, "index.js"), [
    'export default function default21() { return "d3-array-default" }',
    "export function ascending(left, right) { return left < right ? -1 : left > right ? 1 : 0 }",
    "",
  ].join("\n"))

  const source = join(packageRoot, "story.ts")
  await Bun.write(source, [
    'export {governedMarker} from "@fixture/governed.test"',
    'export {default21, ascending} from "d3-dag"',
    "",
  ].join("\n"))
  return Object.freeze({
    source,
    input: Object.freeze({
      packageRoot,
      projectRoot,
      moduleSourcePaths: Object.freeze([source]),
    }),
  })
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zavx0z-storybook-compiler-"))
  temporaryRoots.push(root)
  return root
}

async function linkPackage(root: string, name: string, target: string): Promise<void> {
  const path = join(root, "node_modules", ...name.split("/"))
  await mkdir(dirname(path), {recursive: true})
  await symlink(target, path, "dir")
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), {recursive: true})
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

function resolverFilter(plugin: Bun.BunPlugin): RegExp {
  let filter: RegExp | null = null
  plugin.setup({
    onResolve(options: Readonly<{filter: RegExp}>) {
      filter = options.filter
    },
  } as never)
  if (filter === null) throw new Error("Exact owner resolver registered no onResolve filter")
  return filter
}

function resolveWithPlugin(plugin: Bun.BunPlugin, path: string): Readonly<{path?: string}> {
  const holder: {callback?: (arguments_: Record<string, unknown>) => unknown} = {}
  plugin.setup({
    onResolve(
      _options: Readonly<{filter: RegExp}>,
      candidate: (arguments_: Record<string, unknown>) => unknown,
    ) {
      holder.callback = candidate
    },
  } as never)
  const callback = holder.callback
  if (callback === undefined) throw new Error("Exact owner resolver registered no onResolve callback")
  const result = callback({
    importer: "",
    kind: "import-statement",
    namespace: "file",
    path,
    resolveDir: "",
  })
  if (result === null || typeof result !== "object") {
    throw new Error(`Exact owner resolver returned no result for ${path}`)
  }
  return result as Readonly<{path?: string}>
}
