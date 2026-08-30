import {describe, expect, test} from "bun:test"
import {
  STORYBOOK_RUNTIME_PROTOCOL,
  validateStorybookRuntimeAdapter,
  validateStorybookRuntimeSession,
} from "./runtime-protocol.ts"

describe("external Storybook runtime protocol", () => {
  test("accepts the exact structural adapter and required session lifecycle", () => {
    const session = {
      mount() {},
      update() {},
      unmount() {},
      dispose() {},
    }
    const runtime = {
      protocol: STORYBOOK_RUNTIME_PROTOCOL,
      create() {
        return session
      },
    }

    expect(validateStorybookRuntimeAdapter(runtime)).toBe(runtime)
    expect(validateStorybookRuntimeSession(session)).toBe(session)
  })

  test("keeps update optional", () => {
    const session = {
      mount() {},
      unmount() {},
      dispose() {},
    }

    expect(validateStorybookRuntimeSession(session)).toBe(session)
  })

  test("fails closed for unknown markers and missing adapter methods", () => {
    for (const runtime of [
      null,
      [],
      {},
      {protocol: "storybook-runtime/1", create() {}},
      {protocol: "storybook-runtime/2", create() {}},
      {protocol: STORYBOOK_RUNTIME_PROTOCOL},
      {protocol: STORYBOOK_RUNTIME_PROTOCOL, create: true},
    ]) expect(() => validateStorybookRuntimeAdapter(runtime)).toThrow()
  })

  test("fails closed for incomplete or non-callable session methods", () => {
    const valid = {
      mount() {},
      unmount() {},
      dispose() {},
    }
    for (const session of [
      null,
      [],
      {},
      {...valid, mount: null},
      {...valid, update: null},
      {...valid, styleSheets: ["legacy"]},
      {...valid, styleSheets: ["valid", 1]},
      {...valid, unmount: "no"},
      {...valid, dispose: 1},
    ]) expect(() => validateStorybookRuntimeSession(session)).toThrow()
  })

  test("wraps throwing structural property access as validation failure", () => {
    const runtime = Object.defineProperty({}, "protocol", {
      get(): never {
        throw new Error("owner getter failed")
      },
    })

    expect(() => validateStorybookRuntimeAdapter(runtime)).toThrow(
      "Storybook runtime.protocol could not be read",
    )
  })
})
