import {expect, test} from "bun:test"
import {StorybookBrowserSessionRegistry} from "./server.ts"

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
