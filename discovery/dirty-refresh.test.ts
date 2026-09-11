import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {ExternalStorybookRegistry} from "../catalog/registry.ts"
import {resolveExternalStorybookDeclarations} from "./declarations.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

test("dirty owner повторно анализирует только свой deps spec, а clean open не создаёт API session", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-dirty-discovery-")))
  roots.push(root)
  await Bun.write(join(root, "package.json"), JSON.stringify({
    name: "@fixture/root",
    label: "Root",
    workspaces: ["packages/*"],
  }))
  const config = join(root, "tsconfig.json")
  const baseConfig = join(root, "tsconfig.base.json")
  await Bun.write(baseConfig, JSON.stringify({compilerOptions: {strict: true, noEmit: true}}))
  await Bun.write(config, JSON.stringify({
    extends: "./tsconfig.base.json",
    compilerOptions: {jsx: "preserve"},
    include: ["packages/**/*.ts", "packages/**/*.tsx"],
  }))
  const paths = await Promise.all(["a", "b"].map(async name => {
    const packageRoot = join(root, "packages", name)
    const moduleRoot = join(packageRoot, "component")
    await mkdir(join(moduleRoot, "spec"), {recursive: true})
    await Bun.write(join(packageRoot, "package.json"), JSON.stringify({name: `@fixture/${name}`, label: name.toUpperCase()}))
    await Bun.write(join(moduleRoot, "index.tsx"), `export function ${name.toUpperCase()}() { return <article /> }\n`)
    const spec = join(moduleRoot, "spec/deps.spec.ts")
    await Bun.write(spec, dependencySource(name, "article"))
    const importedType = join(moduleRoot, "types.ts")
    if (name === "a") {
      await mkdir(join(moduleRoot, "contract"), {recursive: true})
      await Bun.write(importedType, "export interface Shared {value: string}\n")
      await Bun.write(join(moduleRoot, "contract/input.ts"), 'import type {Shared} from "../types.ts"\nexport interface Input {shared: Shared}\n')
    }
    return {name, packageRoot, spec, importedType}
  }))

  const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
  const initial = await registry.attach(root)
  const initialB = initial.catalog.scopes.find(scope => scope.id === "@fixture/b")!.directories
  expect(registry.metrics()).toMatchObject({
    resolverCalls: 1,
    cacheHits: 0,
    typescriptApiSessions: {contract: 1, dependency: 2, total: 3},
  })
  const initialA = initial.catalog.scopes.find(scope => scope.id === "@fixture/a")!
  expect(initialA.structurePaths).toContain(paths[0]!.importedType)
  expect(initialA.structurePaths).toContain(config)
  expect(initialA.structurePaths).toContain(baseConfig)

  await Bun.write(paths[0]!.spec, dependencySource("a", "section"))
  registry.markDirty(paths[0]!.spec)
  const refreshed = await registry.refreshIfNeeded()
  const dependency = refreshed.catalog.scopes.find(scope => scope.id === "@fixture/a")!
    .directories?.find(directory => directory.relativePath === "component")?.dependencySpec
  expect(dependency?.cases[0]?.graph["component/index.tsx#A"]?.elements).toEqual(["section"])
  expect(refreshed.catalog.scopes.find(scope => scope.id === "@fixture/b")!.directories).toBe(initialB)
  expect(registry.metrics()).toMatchObject({
    resolverCalls: 2,
    cacheHits: 0,
    typescriptApiSessions: {contract: 2, dependency: 3, total: 5},
  })

  await Bun.write(paths[0]!.importedType, "export interface Shared {count: number}\n")
  registry.markDirty(paths[0]!.importedType)
  const imported = await registry.refreshIfNeeded()
  const inputDocument = imported.catalog.scopes.find(scope => scope.id === "@fixture/a")!
    .directories?.find(directory => directory.relativePath === "component")
    ?.contractDocumentation?.documents[0]?.document
  expect(inputDocument?.declarations[0]?.members[0]?.children?.[0]?.name).toBe("count")
  expect(registry.metrics()).toMatchObject({
    resolverCalls: 3,
    cacheHits: 0,
    typescriptApiSessions: {contract: 3, dependency: 4, total: 7},
  })

  await Bun.write(baseConfig, `${await Bun.file(baseConfig).text()}\n`)
  registry.markDirty(baseConfig)
  await registry.refreshIfNeeded()
  expect(registry.metrics()).toMatchObject({
    resolverCalls: 4,
    cacheHits: 0,
    typescriptApiSessions: {contract: 4, dependency: 5, total: 9},
  })

  await registry.refresh()
  expect(registry.metrics()).toMatchObject({
    resolverCalls: 5,
    cacheHits: 0,
    typescriptApiSessions: {contract: 5, dependency: 7, total: 12},
  })

  await registry.refreshIfNeeded()
  expect(registry.metrics()).toMatchObject({
    resolverCalls: 5,
    cacheHits: 1,
    typescriptApiSessions: {contract: 5, dependency: 7, total: 12},
  })
}, 30000)

function dependencySource(name: string, element: string): string {
  const component = name.toUpperCase()
  return `import {test} from "bun:test"
throw new Error("spec не должен исполняться")
test.each([{
  name: "${component}",
  file: "component/index.tsx",
  expected: {"component/index.tsx#${component}": {uses: [], elements: ["${element}"]}},
}])("Граф $name", () => {})
`
}
