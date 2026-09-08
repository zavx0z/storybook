import {describe, expect, test} from "bun:test"
import {StorybookViewRegistry} from "./view-registry.ts"

describe("Storybook view registry", () => {
  test("projects exact package targets into stable opaque HMAC identities", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(7))
    const targets = [{
      targetId: "CDP-SECRET-TARGET",
      packageId: "@fixture/components",
      type: "page",
      title: "UI",
      url: "http://127.0.0.1:43123/pkg-fixture-components/components/button/default",
    }]
    const first = registry.synchronize(targets, "http://127.0.0.1:43123")
    const second = registry.synchronize(targets, "http://127.0.0.1:43123")
    expect(first).toHaveLength(1)
    expect(second[0]?.viewId).toBe(first[0]?.viewId)
    expect(first[0]?.viewId).toStartWith("storybook-view-v1_")
    expect(JSON.stringify(first)).not.toContain("CDP-SECRET-TARGET")
    expect(first[0]).toMatchObject({
      packageId: "@fixture/components",
      route: "components/button/default",
    })
    expect(registry.internal(first[0]!.viewId).targetId).toBe("CDP-SECRET-TARGET")
  })

  test("keeps multiple views of a package and invalidates a handle when its tab changes package", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(9))
    const origin = "http://127.0.0.1:43123"
    const views = registry.synchronize([
      {packageId: "@fixture/a", targetId: "A", type: "page", title: "A", url: `${origin}/pkg-fixture-a/`},
      {packageId: "@fixture/a", targetId: "B", type: "page", title: "B", url: `${origin}/pkg-fixture-a/example?preview=revision-a`},
    ], origin)
    expect(views).toHaveLength(2)
    expect(views[0]!.viewId).not.toBe(views[1]!.viewId)
    const changed = registry.synchronize([
      {packageId: "@fixture/b", targetId: "A", type: "page", title: "Other", url: `${origin}/pkg-fixture-b/`},
    ], origin)
    expect(changed[0]!.viewId).not.toBe(views[0]!.viewId)
    expect(() => registry.internal(views[0]!.viewId)).toThrow("Unknown")
  })

  test("ignores landing, foreign-origin and non-page targets", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(3))
    expect(registry.synchronize([
      {packageId: "a", targetId: "landing", type: "page", title: "Landing", url: "http://127.0.0.1:43123/"},
      {packageId: "a", targetId: "foreign", type: "page", title: "Foreign", url: "http://127.0.0.1:9999/packages/a/"},
      {packageId: "a", targetId: "worker", type: "worker", title: "Worker", url: "http://127.0.0.1:43123/packages/a/"},
    ], "http://127.0.0.1:43123")).toEqual([])
  })
})
