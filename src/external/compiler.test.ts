import {afterEach, describe, expect, test} from "bun:test"
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {createStorybookPackageCompilerPlugins} from "./compiler.ts"

const temporaryRoots: string[] = []

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

    expect(plugins.map(({name}) => name)).toEqual(["external-storybook-exact-owner-resolution"])
    expect(Object.isFrozen(plugins)).toBeTrue()
  })

  test("resolves a fresh Template plugin and exact manifest-reached source roots", async () => {
    const fixture = await templateProjectFixture()
    const first = await createStorybookPackageCompilerPlugins(fixture.input)
    const second = await createStorybookPackageCompilerPlugins(fixture.input)

    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)
    expect(first[0]).not.toBe(second[0])
    expect(first.map(({name}) => name)).toEqual([
      "external-storybook-exact-owner-resolution",
      "fixture-template-1",
    ])
    expect(second.map(({name}) => name)).toEqual([
      "external-storybook-exact-owner-resolution",
      "fixture-template-2",
    ])
    const canonicalProjectRoot = await realpath(fixture.projectRoot)
    const canonicalDependencyRoots = await Promise.all([
      fixture.linkedRoot,
      fixture.templateRoot,
      fixture.transitiveRoot,
    ].map(async (path) => await realpath(path)))
    expect(fixtureOptions(first[1]!)).toEqual({
      cwd: canonicalProjectRoot,
      persistent: false,
      sourceRoots: [
        canonicalProjectRoot,
        ...canonicalDependencyRoots.sort(),
      ],
    })
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

  test("structurally rejects missing factories and invalid plugin results", async () => {
    for (const adapterSource of [
      "export const unsupported = true",
      "export function createTemplateJsxBunPlugin() { return {name: 'broken'} }",
    ]) {
      const fixture = await templateProjectFixture(adapterSource)
      await expect(createStorybookPackageCompilerPlugins(fixture.input)).rejects.toThrow()
    }
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

async function templateProjectFixture(adapterSource = String.raw`
let instance = 0
export function createTemplateJsxBunPlugin(options) {
  instance += 1
  return {
    name: "fixture-template-" + instance,
    setup() {},
    fixtureOptions: options,
  }
}
`): Promise<Readonly<{
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
  const templateRoot = join(root, "owners", "template")
  const linkedRoot = join(root, "owners", "linked")
  const transitiveRoot = join(root, "owners", "transitive")
  await Promise.all([projectRoot, packageRoot, templateRoot, linkedRoot, transitiveRoot]
    .map((path) => mkdir(path, {recursive: true})))

  await writeJson(join(projectRoot, "package.json"), {
    name: "@fixture/project",
    workspaces: ["packages/*"],
    dependencies: {
      "@fixture/owner": "workspace:*",
      "@fixture/linked": "link:@fixture/linked",
    },
    devDependencies: {"@zavx0z/template": "link:@zavx0z/template"},
  })
  await writeJson(join(packageRoot, "package.json"), {name: "@fixture/owner"})
  await writeJson(join(templateRoot, "package.json"), {
    name: "@zavx0z/template",
    type: "module",
    exports: {"./bun": "./bun.js"},
  })
  await Bun.write(join(templateRoot, "bun.js"), adapterSource)
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

function fixtureOptions(plugin: Bun.BunPlugin): unknown {
  return (plugin as Bun.BunPlugin & Readonly<{fixtureOptions: unknown}>).fixtureOptions
}
