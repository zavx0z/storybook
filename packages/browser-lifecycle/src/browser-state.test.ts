import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync, statSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {StorybookBrowserState} from "./browser-state.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("Storybook browser state", () => {
  test("persists one private view secret across lifecycle instances", () => {
    const root = temporaryRoot()
    const first = new StorybookBrowserState(root)
    const second = new StorybookBrowserState(root)

    expect(first.secret()).toEqual(second.secret())
    expect(first.secret()).toHaveLength(32)
    expect(statSync(root).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, "view-secret")).mode & 0o777).toBe(0o600)
  })

  test("atomically records and conditionally clears the owned package target", () => {
    const state = new StorybookBrowserState(temporaryRoot())
    const written = state.writeTarget({
      packageId: "@fixture/a",
      cdpOrigin: "http://127.0.0.1:9222",
      browserIdentity: "a".repeat(64),
      targetId: "TARGET_A",
    })

    expect(state.readTarget("@fixture/a")).toEqual(written)
    expect(state.clearTarget("@fixture/a", "OTHER_TARGET")).toBeFalse()
    expect(state.readTarget("@fixture/a")).toEqual(written)
    expect(state.clearTarget("@fixture/a", "TARGET_A")).toBeTrue()
    expect(state.readTarget("@fixture/a")).toBeNull()
  })

  test("persists an atomic reservation before binding its created target", () => {
    const state = new StorybookBrowserState(temporaryRoot())
    const reserved = state.reserveTarget({
      packageId: "@fixture/a",
      cdpOrigin: "http://127.0.0.1:9222",
      browserIdentity: "a".repeat(64),
      url: "http://127.0.0.1:43123/packages/%40fixture%2Fa/",
      baselineTargetIds: ["BEFORE_A", "BEFORE_B"],
    })
    expect(reserved).toMatchObject({phase: "reserved", targetId: null})

    const owned = state.writeTarget({
      packageId: "@fixture/a",
      cdpOrigin: "http://127.0.0.1:9222",
      browserIdentity: "a".repeat(64),
      targetId: "CREATED",
    })
    expect(owned).toMatchObject({
      phase: "owned",
      targetId: "CREATED",
      url: reserved.url,
      baselineTargetIds: ["BEFORE_A", "BEFORE_B"],
    })
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-browser-state-"))
  roots.push(root)
  return root
}
