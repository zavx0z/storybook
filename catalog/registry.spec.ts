import {afterEach, describe, expect, test} from "bun:test"
import {existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import type {StorybookCatalog} from "./catalog.t.ts"
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
})

function fixtureRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-catalog-source-")))
  roots.push(root)
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/structure"}))
  writeFileSync(join(root, "identity.ts"), "export const identity = (value: unknown) => value\n")
  return root
}
