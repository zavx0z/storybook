import {createHash} from "node:crypto"
import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {StorybookBrowserState} from "../src/browser-state.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("Storybook browser state", () => {
  test("освобождает только доказанно неотправленную reservation, старый missing marker остаётся unknown", () => {
    const root = temporaryRoot()
    const state = new StorybookBrowserState(root)
    const input = {
      packageId: "@fixture/a",
      cdpOrigin: "http://127.0.0.1:9222",
      browserIdentity: "a".repeat(64),
      url: "http://127.0.0.1:43123/pkg-fixture-a/",
      baselineTargetIds: [],
    }
    state.reserveWorkspace(input)
    expect(state.clearUnsentReservation()).toBeTrue()
    expect(state.readWorkspace()).toBeNull()
    state.reserveWorkspace(input)
    state.markCreateSent()
    expect(state.clearUnsentReservation()).toBeFalse()
    const legacy: Record<string, unknown> = {...state.readWorkspace()}
    delete legacy.createSent
    const path = join(root, readdirSync(root).find(name => name === "workspace.json")!)
    writeFileSync(path, JSON.stringify(legacy))
    expect(state.readWorkspace()).toMatchObject({phase: "reserved", createSent: true})
    expect(state.clearUnsentReservation()).toBeFalse()
    state.writeWorkspace({...input, targetId: "OWNED"})
    expect(state.clearUnsentReservation()).toBeFalse()
  })

  test("мигрирует owned записи в один workspace, неизвестный dispatch сохраняет", () => {
    const root = temporaryRoot()
    const state = new StorybookBrowserState(root)
    const legacy = (packageId: string, phase: "owned" | "reserved") => ({
      protocol: "external-storybook-browser-target/3", packageId, phase,
      cdpOrigin: "http://127.0.0.1:9222", browserIdentity: "a".repeat(64),
      targetId: phase === "owned" ? "OLD_TARGET" : null, createSent: true,
      url: "http://127.0.0.1:43123/pkg-fixture-a/", baselineTargetIds: ["OLD_TARGET"],
      recordedAt: new Date().toISOString(),
    })
    const ownedName = `target-${createHash("sha256").update("@fixture/a").digest("hex")}.json`
    const pendingName = `target-${createHash("sha256").update("@fixture/b").digest("hex")}.json`
    writeFileSync(join(root, ownedName), JSON.stringify(legacy("@fixture/a", "owned")))
    writeFileSync(join(root, pendingName), JSON.stringify(legacy("@fixture/b", "reserved")))
    expect(state.readWorkspace()).toMatchObject({phase: "reserved", createSent: true})
    expect(state.hasWorkspace()).toBeFalse()
    state.writeWorkspace({packageId: null, cdpOrigin: "http://127.0.0.1:9222", browserIdentity: "a".repeat(64), targetId: "OLD_TARGET"})
    expect(state.readWorkspace()).toMatchObject({phase: "owned", packageId: null, targetId: "OLD_TARGET"})
    expect(readdirSync(root)).toContain("workspace.json")
    expect(readdirSync(root)).not.toContain(ownedName)
    expect(readdirSync(root)).toContain(pendingName)
  })

  test("persists one private view secret across lifecycle instances", () => {
    const root = temporaryRoot()
    const first = new StorybookBrowserState(root)
    const second = new StorybookBrowserState(root)

    expect(first.secret()).toEqual(second.secret())
    expect(first.secret()).toHaveLength(32)
    expect(statSync(root).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, "view-secret")).mode & 0o777).toBe(0o600)
  })

  test("atomically records and conditionally clears the owned workspace target", () => {
    const state = new StorybookBrowserState(temporaryRoot())
    const written = state.writeWorkspace({
      packageId: "@fixture/a",
      cdpOrigin: "http://127.0.0.1:9222",
      browserIdentity: "a".repeat(64),
      targetId: "TARGET_A",
    })

    expect(state.readWorkspace()).toEqual(written)
    expect(state.clearWorkspace("OTHER_TARGET")).toBeFalse()
    expect(state.readWorkspace()).toEqual(written)
    expect(state.clearWorkspace("TARGET_A")).toBeTrue()
    expect(state.readWorkspace()).toBeNull()
  })

  test("persists an atomic reservation before binding its created target", () => {
    const state = new StorybookBrowserState(temporaryRoot())
    const reserved = state.reserveWorkspace({
      packageId: "@fixture/a",
      cdpOrigin: "http://127.0.0.1:9222",
      browserIdentity: "a".repeat(64),
      url: "http://127.0.0.1:43123/pkg-fixture-a/",
      baselineTargetIds: ["BEFORE_A", "BEFORE_B"],
    })
    expect(reserved).toMatchObject({phase: "reserved", targetId: null})

    const owned = state.writeWorkspace({
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
