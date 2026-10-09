import {expect, test} from "bun:test"
import {StorybookBrowserSessionRegistry} from "../src/browser-session-registry.ts"

test("browser grant сохраняет immutable preview intent", () => {
  const registry = new StorybookBrowserSessionRegistry()
  const issued = registry.issue({
    kind: "package",
    packageId: "@fixture/package",
    revision: "revision-b",
    intent: "preview",
    preview: true,
  })

  const grant = registry.consume(issued.token)
  expect(grant.preview).toBeTrue()
  expect(grant.intent).toBe("preview")
  expect(Object.isFrozen(grant)).toBeTrue()
})

test("browser grant отклоняет расхождение preview flag и bootstrap intent", () => {
  const registry = new StorybookBrowserSessionRegistry()

  expect(() => registry.issue({
    kind: "package",
    packageId: "@fixture/package",
    revision: "revision-b",
    intent: "preview",
    preview: false,
  })).toThrow("preview and bootstrap intent must agree")
})


test("environment activity has a dedicated authorized topic in landing and package grants", () => {
  const registry = new StorybookBrowserSessionRegistry()
  const landing = registry.issue({kind: "registry", packageId: null, revision: null})
  const selected = registry.issue({kind: "package", packageId: "@fixture/package", revision: "current"})
  expect(landing.grant.allowedTopics.has("environment")).toBeTrue()
  expect(selected.grant.allowedTopics.has("environment")).toBeTrue()
  expect(selected.grant.allowedTopics.has("registry")).toBeFalse()
})
