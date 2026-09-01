import {describe, expect, test} from "bun:test"
import {StorybookViewRegistry} from "./view-registry.ts"

describe("Storybook view registry", () => {
  test("projects exact package targets into stable opaque HMAC identities", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(7))
    const targets = [{
      targetId: "CDP-SECRET-TARGET",
      type: "page",
      title: "UI",
      url: "http://127.0.0.1:43123/packages/%40ui%2Fcomponents/components/button/default",
    }]
    const first = registry.synchronize(targets, "http://127.0.0.1:43123")
    const second = registry.synchronize(targets, "http://127.0.0.1:43123")
    expect(first).toHaveLength(1)
    expect(second[0]?.viewId).toBe(first[0]?.viewId)
    expect(first[0]?.viewId).toStartWith("storybook-view-v1_")
    expect(JSON.stringify(first)).not.toContain("CDP-SECRET-TARGET")
    expect(first[0]).toMatchObject({
      packageId: "@ui/components",
      route: "components/button/default",
    })
    expect(registry.internal(first[0]!.viewId).targetId).toBe("CDP-SECRET-TARGET")
  })

  test("makes duplicate logical package views unrepresentable", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(9))
    const origin = "http://127.0.0.1:43123"
    const retained = registry.synchronize([
      {targetId: "A", type: "page", title: "A", url: `${origin}/packages/%40fixture%2Fa/`},
    ], origin)
    expect(() => registry.synchronize([
      {targetId: "A", type: "page", title: "A", url: `${origin}/packages/%40fixture%2Fa/`},
      {targetId: "B", type: "page", title: "B", url: `${origin}/packages/%40fixture%2Fa/example`},
    ], origin)).toThrow("Duplicate Storybook logical package view")
    expect(registry.list()).toEqual(retained)
  })

  test("ignores landing, foreign-origin and non-page targets", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(3))
    expect(registry.synchronize([
      {targetId: "landing", type: "page", title: "Landing", url: "http://127.0.0.1:43123/"},
      {targetId: "foreign", type: "page", title: "Foreign", url: "http://127.0.0.1:9999/packages/a/"},
      {targetId: "worker", type: "worker", title: "Worker", url: "http://127.0.0.1:43123/packages/a/"},
    ], "http://127.0.0.1:43123")).toEqual([])
  })
})
