import {describe, expect, test} from "bun:test"
import {
  defineStorybookStoryCatalog,
  type StorybookStoryCatalog,
} from "./stories.ts"

type OwnerStory = Readonly<{
  id: string
  mount(): string
}>

function ownerCatalog(load: () => Promise<unknown>): StorybookStoryCatalog<OwnerStory> {
  return defineStorybookStoryCatalog({
    groups: [{
      id: "examples",
      label: "Примеры",
      components: [{
        id: "surface",
        label: "Поверхность",
        apiName: "Surface",
        tags: ["webgpu"],
        sections: [{
          id: "basic",
          label: "Основное",
          variants: [{
            id: "default",
            label: "Обычная",
            title: "Поверхность Engine",
            tags: ["canvas"],
            load,
          }],
        }],
      }],
    }],
    representative: {component: "surface", section: "basic", variant: "default"},
    normalizeModule(route, loaded): OwnerStory {
      if (loaded === null || typeof loaded !== "object") {
        throw new Error(`Owner story must be an object: ${route}`)
      }
      const candidate = loaded as Partial<OwnerStory>
      if (typeof candidate.id !== "string" || typeof candidate.mount !== "function") {
        throw new Error(`Invalid owner story module: ${route}`)
      }
      return Object.freeze({id: candidate.id, mount: candidate.mount})
    },
  })
}

describe("target-agnostic Storybook story catalog", () => {
  test("keeps metadata eager without requiring a UiSurface renderer", () => {
    let loads = 0
    const catalog = ownerCatalog(async () => {
      loads += 1
      return {id: "surface", mount: () => "mounted"}
    })

    expect(catalog.representative).toBe("surface/basic/default")
    expect(catalog.routeTree.overviews).toEqual(["", "surface", "surface/basic"])
    expect(catalog.routeTree.leaves).toEqual(["surface/basic/default"])
    expect(catalog.find("surface/basic/default")).toMatchObject({
      groupId: "examples",
      componentId: "surface",
      sectionId: "basic",
      variantId: "default",
      tags: ["webgpu", "canvas"],
    })
    expect(catalog.variants("surface/basic/default")).toEqual(catalog.index)
    expect(catalog.find("surface/basic/missing")).toBeUndefined()
    expect(catalog.variants("surface/basic/missing")).toEqual([])
    expect(loads).toBe(0)
  })

  test("normalizes one lazy value and caches the exact pending promise", async () => {
    let loads = 0
    const catalog = ownerCatalog(async () => {
      loads += 1
      return {id: "surface", mount: () => "mounted"}
    })

    const first = catalog.load("surface/basic/default")
    const second = catalog.load("surface/basic/default")
    expect(second).toBe(first)
    expect((await first).mount()).toBe("mounted")
    expect(loads).toBe(1)
  })

  test("removes rejected validation from the cache and retries the owner loader", async () => {
    let attempts = 0
    const catalog = ownerCatalog(async () => {
      attempts += 1
      return attempts === 1
        ? {id: "invalid"}
        : {id: "surface", mount: () => "recovered"}
    })

    await expect(catalog.load("surface/basic/default")).rejects.toThrow(
      "Invalid owner story module: surface/basic/default",
    )
    expect((await catalog.load("surface/basic/default")).mount()).toBe("recovered")
    expect(attempts).toBe(2)
  })

  test("fails closed before loading and rejects a missing normalizer", async () => {
    let loads = 0
    const catalog = ownerCatalog(async () => {
      loads += 1
      return {id: "surface", mount: () => "mounted"}
    })

    await expect(catalog.load("surface/basic/missing")).rejects.toThrow(
      "Unknown storybook story route: surface/basic/missing",
    )
    expect(loads).toBe(0)

    expect(() => defineStorybookStoryCatalog({
      groups: [],
      representative: {component: "surface", section: "basic", variant: "default"},
      normalizeModule: null,
    } as never)).toThrow("normalizeModule must be a function")
  })
})
