import {describe, expect, test} from "bun:test"
import {
  defineStorybookDomCatalog,
  storybookDomCatalogRoute,
} from "./catalog.ts"

describe("DOM Storybook catalog", () => {
  test("builds exact overview/leaf routes and caches one validated lazy module", async () => {
    let loads = 0
    const catalog = defineStorybookDomCatalog({
      groups: [{
        id: "engine",
        label: "Engine",
        components: [{
          id: "space",
          label: "Space",
          apiName: "Space",
          tags: ["webgpu"],
          sections: [{
            id: "coordinates",
            label: "Coordinates",
            variants: [{
              id: "z-up",
              label: "Z up",
              title: "Right-handed Z up",
              load: async () => ({kind: "scene", load: ++loads}),
            }],
          }],
        }],
      }],
      representative: {component: "space", section: "coordinates", variant: "z-up"},
      normalizeModule(route, value) {
        expect(route).toBe("space/coordinates/z-up")
        return Object.freeze(value)
      },
    })

    expect(catalog.routeTree.find("")?.kind).toBe("overview")
    expect(catalog.routeTree.find("space")?.kind).toBe("overview")
    expect(catalog.routeTree.find("space/coordinates/z-up")?.kind).toBe("leaf")
    expect(catalog.index[0]?.tags).toEqual(["webgpu"])
    expect(catalog.representative).toBe("space/coordinates/z-up")
    const [first, second] = await Promise.all([
      catalog.load(catalog.representative),
      catalog.load(catalog.representative),
    ])
    expect(first).toBe(second)
    expect(loads).toBe(1)
  })

  test("fails closed for malformed hierarchy and unknown routes", async () => {
    expect(() => storybookDomCatalogRoute({
      component: "Space",
      section: "basic",
      variant: "default",
    })).toThrow("Invalid Storybook DOM component id")
    const catalog = defineStorybookDomCatalog({
      groups: [{
        id: "group",
        label: "Group",
        components: [{
          id: "item",
          label: "Item",
          apiName: "Item",
          sections: [{
            id: "basic",
            label: "Basic",
            variants: [{
              id: "default",
              label: "Default",
              title: "Default item",
              load: async () => 1,
            }],
          }],
        }],
      }],
      representative: {component: "item", section: "basic", variant: "default"},
      normalizeModule: (_route, value) => value,
    })
    expect(catalog.find("unknown")).toBeUndefined()
    await expect(catalog.load("unknown")).rejects.toThrow("Unknown Storybook DOM route")
  })

  test("has no retained UI target dependency", async () => {
    const source = await Bun.file(new URL("catalog.ts", import.meta.url)).text()
    for (const forbidden of ["@layout/", "@ui/elements", "@ui/components", "UiSurface", "UiRuntime"]) {
      expect(source).not.toContain(forbidden)
    }
    const manifest = await Bun.file(new URL("../../package.json", import.meta.url)).json() as {
      exports: Record<string, string>
    }
    expect(manifest.exports["./catalog"]).toBe("./src/dom/catalog.ts")
  })
})
