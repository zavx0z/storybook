import {describe, expect, test} from "bun:test"
import {StorybookViewRegistry} from "../src/view-registry.ts"

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
    const selected = registry.synchronize(targets.map(target => ({
      ...target, url: `${target.url}?preview=revision-a&inspector=output`,
    })), "http://127.0.0.1:43123")
    expect(selected[0]?.viewId).toBe(first[0]?.viewId)
    expect(selected[0]?.route).toBe(first[0]?.route)
  })

  test("получает принадлежность структурного адреса из подтверждённого bridge", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(7))
    const origin = "http://127.0.0.1:43123"
    const views = registry.synchronize([{
      targetId: "STRUCTURAL", packageId: "@zavx0z/immersive/nodes/node", route: "diagram/scenarios",
      type: "page", title: "Diagram", url: `${origin}/immersive/nodes/node/diagram?view=scenarios&variant=Круг`,
    }], origin)
    expect(views.map(({packageId, route}) => ({packageId, route}))).toEqual([
      {packageId: "@zavx0z/immersive/nodes/node", route: "diagram/scenarios"},
    ])
  })

  test("единственное пространство инвалидирует handle при смене пакета и предмета", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(9))
    const origin = "http://127.0.0.1:43123"
    const target = {packageId: "@fixture/a", targetId: "A", type: "page", title: "A", url: `${origin}/pkg-fixture-a/example`}
    const first = registry.register(target, origin)
    const moved = registry.register({...target, url: `${origin}/pkg-fixture-a/other`}, origin)
    expect(moved.viewId).not.toBe(first.viewId)
    expect(() => registry.internal(first.viewId)).toThrow("Unknown")
    const changed = registry.register({...target, packageId: "@fixture/b", url: `${origin}/pkg-fixture-b/`}, origin)
    expect(changed.viewId).not.toBe(moved.viewId)
    expect(() => registry.internal(moved.viewId)).toThrow("Unknown")
    expect(registry.list()).toEqual([changed])
    expect(() => registry.synchronize([target, {...target, targetId: "B"}], origin)).toThrow("one canonical workspace")
  })

  test("корень Project является тем же пространством с null packageId", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(9))
    const origin = "http://127.0.0.1:43123"
    const view = registry.register({packageId: null, targetId: "A", type: "page", title: "Project", url: `${origin}/`}, origin)
    expect(view).toMatchObject({packageId: null, route: ""})
  })

  test("ignores landing, foreign-origin and non-page targets", () => {
    const registry = new StorybookViewRegistry(new Uint8Array(32).fill(3))
    for (const target of [
      {packageId: "a", targetId: "landing", type: "page", title: "Landing", url: "http://127.0.0.1:43123/"},
      {packageId: "a", targetId: "foreign", type: "page", title: "Foreign", url: "http://127.0.0.1:9999/packages/a/"},
      {packageId: "a", targetId: "worker", type: "worker", title: "Worker", url: "http://127.0.0.1:43123/packages/a/"},
    ]) expect(registry.synchronize([target], "http://127.0.0.1:43123")).toEqual([])
  })
})
