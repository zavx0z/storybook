import {afterEach, describe, expect, test} from "bun:test"
import {existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import type {StorybookCatalog, StorybookPackage} from "./catalog.t.ts"
import {ExternalStorybookRegistry} from "./registry.ts"
import {externalStorybookNode, externalStorybookRoutes} from "./graph.ts"
import {documentationCatalog} from "./registry.fixture.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("Источник нормализованного каталога", () => {
  test("принимает исходники без manifest и сохраняет их точное происхождение", async () => {
    const root = fixtureRoot()
    const calls: string[][] = []
    const registry = new ExternalStorybookRegistry(async (inputs) => {
      calls.push([...inputs])
      return documentationCatalog(root)
    })

    const snapshot = await registry.attach(root)
    expect(calls).toEqual([[root]])
    expect(existsSync(join(root, ".storybook"))).toBeFalse()
    expect(externalStorybookRoutes(snapshot.graph).map(({path}) => path)).toEqual([
      "",
      "transformations",
      "transformations/identity",
    ])
    expect(externalStorybookNode(snapshot.graph, "subject:@fixture/structure/transformations/identity").source)
      .toEqual({path: join(root, "identity.ts"), pointer: "export:identity"})
    const descriptor = registry.packageDescriptors()[0]!
    expect(descriptor.sourcePath).toBe(join(root, "package.json"))
    expect(descriptor.watchPaths).toContainEqual({path: join(root, "identity.ts"), category: "declaration"})
    expect(descriptor.runtime).toBeNull()
    expect(descriptor.variants).toEqual([])
    expect(descriptor.widgetModules).toEqual([])
  })

  test("сохраняет рабочий граф при ошибке источника и конфликте идентичности", async () => {
    const root = fixtureRoot()
    const valid = documentationCatalog(root)
    let candidate: StorybookCatalog | Error = valid
    const registry = new ExternalStorybookRegistry(async () => {
      if (candidate instanceof Error) throw candidate
      return candidate
    })
    const working = await registry.attach(root)

    candidate = new Error("Неоднозначная связь спецификации с модулем")
    await expect(registry.refresh()).rejects.toThrow("Неоднозначная связь")
    expect(registry.snapshot()).toEqual(working)

    candidate = {...valid, scopes: [...valid.scopes, ...valid.scopes]}
    await expect(registry.refresh()).rejects.toThrow("Duplicate resolved external Storybook declaration")
    expect(registry.snapshot()).toEqual(working)
  })

  test("чистый conditional refresh не вызывает resolver и публикует отдельный cache hit", async () => {
    const root = fixtureRoot()
    let calls = 0
    const registry = new ExternalStorybookRegistry(async () => {
      calls += 1
      return documentationCatalog(root)
    })
    const configured = await registry.attach(root)
    const warm = await registry.refreshIfNeeded()
    expect(warm.revision).toBe(configured.revision)
    expect(warm.graph).toBe(configured.graph)
    expect(calls).toBe(1)
    expect(registry.metrics()).toEqual({
      refreshing: false,
      resolverCalls: 1,
      graphRebuilds: 1,
      cacheHits: 1,
      typescriptApiSessions: {contract: 0, dependency: 0, total: 0},
    })

    await registry.refresh()
    expect(calls).toBe(2)
    expect(registry.metrics()).toEqual({
      refreshing: false,
      resolverCalls: 2,
      graphRebuilds: 1,
      cacheHits: 1,
      typescriptApiSessions: {contract: 0, dependency: 0, total: 0},
    })
  })

  test("coalesces concurrent refresh и не теряет dirty path во время resolver", async () => {
    const root = fixtureRoot()
    let calls = 0
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const registry = new ExternalStorybookRegistry(async () => {
      calls += 1
      if (calls === 2) {
        started()
        await gate
      }
      return documentationCatalog(root)
    })
    await registry.attach(root)
    registry.markDirty(join(root, "identity.ts"))
    const first = registry.refreshIfNeeded()
    await entered
    registry.markDirty(join(root, "package.json"))
    const second = registry.refreshIfNeeded()
    expect(second).toBe(first)
    release()
    await first
    expect(calls).toBe(3)
    expect(registry.dirtySnapshot()).toEqual({dirty: false, paths: [], scopeRoots: []})
  })

  test("failed refresh остаётся dirty и сохраняет принятый graph", async () => {
    const root = fixtureRoot()
    let failure = false
    const registry = new ExternalStorybookRegistry(async () => {
      if (failure) throw new Error("source failed")
      return documentationCatalog(root)
    })
    const working = await registry.attach(root)
    failure = true
    registry.markDirty(join(root, "identity.ts"))
    await expect(registry.refreshIfNeeded()).rejects.toThrow("source failed")
    expect(registry.snapshot().revision).toBe(working.revision)
    expect(registry.snapshot().graph).toBe(working.graph)
    expect(registry.dirtySnapshot()).toEqual({
      dirty: true,
      paths: [join(root, "identity.ts")],
      scopeRoots: [root],
    })
  })

  test("общий импортированный source помечает каждого потребителя", async () => {
    const left = fixtureRoot()
    const right = fixtureRoot()
    const shared = join(left, "shared-types.ts")
    const catalog = sharedSourceCatalog(left, right, shared)
    const registry = new ExternalStorybookRegistry(async () => catalog)
    await registry.attachMany([left, right])
    expect(registry.markDirty(shared)).toEqual({
      dirty: true,
      paths: [shared],
      scopeRoots: [left, right].sort(),
    })
  })
})

function fixtureRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-catalog-source-")))
  roots.push(root)
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/structure"}))
  writeFileSync(join(root, "identity.ts"), "export const identity = (value: unknown) => value\n")
  return root
}

function sharedSourceCatalog(left: string, right: string, shared: string): StorybookCatalog {
  const owner = (root: string, id: string): StorybookPackage => Object.freeze({
    ...(documentationCatalog(root).scopes[0] as StorybookPackage),
    canonicalId: `package:${id}`,
    id,
    packageName: id,
    label: id,
    scopeRoot: root,
    source: Object.freeze({path: join(root, "package.json"), pointer: "/name"}),
    packageJsonPath: join(root, "package.json"),
    structurePaths: Object.freeze([shared]),
    digest: id,
    catalog: null,
  })
  return Object.freeze({
    schemaVersion: 1,
    rootIds: Object.freeze(["package:@fixture/left", "package:@fixture/right"]),
    scopes: Object.freeze([
      owner(left, "@fixture/left"),
      owner(right, "@fixture/right"),
    ]),
  })
}
