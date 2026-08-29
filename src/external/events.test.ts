import {describe, expect, test} from "bun:test"
import {StorybookEventHub} from "./events.ts"

describe("Storybook event hub", () => {
  test("delivers matching events and times out without polling", async () => {
    const hub = new StorybookEventHub<{type: string; revision: string}>(2)
    const waiting = hub.wait((event) => event.revision === "next", {timeoutMs: 1_000})
    hub.publish({type: "package.built", revision: "old"})
    hub.publish({type: "package.built", revision: "next"})
    expect(await waiting).toEqual({type: "package.built", revision: "next"})
    expect(await hub.wait(() => false, {timeoutMs: 1})).toBeNull()
  })

  test("keeps bounded history and supports cancellation", async () => {
    const hub = new StorybookEventHub<{type: string; revision: string}>(1)
    hub.publish({type: "package.built", revision: "old"})
    hub.publish({type: "package.built", revision: "current"})
    expect(hub.recent((event) => event.revision === "old")).toBeNull()
    const abort = new AbortController()
    const waiting = hub.wait(() => false, {timeoutMs: 1_000, signal: abort.signal})
    abort.abort(new Error("cancelled"))
    await expect(waiting).rejects.toThrow("cancelled")
  })
})
