import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {PNG} from "pngjs"
import {StorybookBrowserState} from "./browser-state.ts"
import type {ChromeTargetSummary, StorybookBridgeMethod, StorybookChromeClient} from "./contract.ts"
import {createStorybookBrowserLifecycle, type StorybookBrowserLifecycle} from "./service.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("Storybook browser lifecycle service", () => {
  test("reuses one package view and never returns the CDP target identity", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const input = {
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
    }
    const first = await controller.openPackage(input)
    const second = await controller.openPackage(input)
    expect(first.reused).toBeFalse()
    expect(second.reused).toBeTrue()
    expect(chrome.created).toBe(1)
    expect(first.view.viewId).toBe(second.view.viewId)
    expect(JSON.stringify(first)).not.toContain(chrome.targetId)
    expect(JSON.stringify(first.view)).not.toContain("43123")
    expect(first.view).not.toHaveProperty("origin")
    expect(first.view).not.toHaveProperty("url")
    expect(chrome.activated).toEqual([])
  })

  test("adopts an attested package target from the previous server origin", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [{
      targetId: "OLD_TARGET",
      type: "page",
      title: "Old Storybook",
      url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default",
    }]
    const opened = await createController(chrome).openPackage(openInput(chrome))

    expect(opened.reused).toBeTrue()
    expect(chrome.created).toBe(0)
    expect(chrome.navigations).toBe(1)
    expect(chrome.targetsValue).toEqual([expect.objectContaining({
      targetId: "OLD_TARGET",
      url: openInput(chrome).url,
    })])
  })

  test("normalizes only attested legacy duplicates before publishing one logical view", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "A", url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default"},
      {targetId: "OLD_B", type: "page", title: "B", url: "http://127.0.0.1:42000/packages/%40fixture%2Fa/fixture/a/default"},
    ]
    const opened = await createController(chrome).openPackage({...openInput(chrome), foreground: true})

    expect(opened.reused).toBeTrue()
    expect(chrome.closed).toEqual(["OLD_B"])
    expect(chrome.activated).toEqual(["OLD_A"])
    const closeIndex = chrome.targetOperations.indexOf("close:OLD_B")
    const activateIndex = chrome.targetOperations.indexOf("activate:OLD_A")
    expect(closeIndex).toBeGreaterThanOrEqual(0)
    expect(activateIndex).toBeGreaterThan(closeIndex)
    expect(chrome.targetOperations.slice(closeIndex + 1, activateIndex)).toContain("identity:OLD_A")
    expect(chrome.targetsValue).toEqual([expect.objectContaining({targetId: "OLD_A"})])
  })

  test("leaves an unattested foreign tab untouched", async () => {
    const chrome = new FakeChrome()
    chrome.foreignTargetIds.add("FOREIGN")
    chrome.targetsValue = [{
      targetId: "FOREIGN",
      type: "page",
      title: "Foreign",
      url: openInput(chrome).url,
    }]
    const opened = await createController(chrome).openPackage(openInput(chrome))

    expect(opened.reused).toBeFalse()
    expect(chrome.created).toBe(1)
    expect(chrome.closed).toEqual([])
    expect(chrome.targetsValue.map(({targetId}) => targetId)).toEqual(["FOREIGN", chrome.targetId])
  })

  test("persists provisional ownership when the first bridge readiness attempt fails", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.unavailableBridgeCalls = Number.MAX_SAFE_INTEGER
    await expect(createController(chrome, root).openPackage({...openInput(chrome), timeoutMs: 100}))
      .rejects.toMatchObject({name: "TimeoutError"})

    chrome.unavailableBridgeCalls = 0
    const opened = await createController(chrome, root).openPackage(openInput(chrome))

    expect(opened.reused).toBeTrue()
    expect(chrome.created).toBe(1)
  })

  test("recovers a target created after reservation when the owner crashes before binding", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.throwAfterCreate = true
    await expect(createController(chrome, root).openPackage(openInput(chrome)))
      .rejects.toThrow("simulated owner crash")

    chrome.throwAfterCreate = false
    const opened = await createController(chrome, root).openPackage(openInput(chrome))

    expect(opened.reused).toBeTrue()
    expect(chrome.created).toBe(1)
  })

  test("fails closed instead of sending a second create while a reserved target is indeterminate", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.deferCreatedTarget = true
    chrome.throwAfterCreate = true
    await expect(createController(chrome, root).openPackage(openInput(chrome)))
      .rejects.toThrow("simulated owner crash")

    chrome.throwAfterCreate = false
    await expect(createController(chrome, root).openPackage(openInput(chrome)))
      .rejects.toThrow("target creation is indeterminate")
    expect(chrome.created).toBe(1)

    chrome.materializeCreatedTarget()
    const opened = await createController(chrome, root).openPackage(openInput(chrome))
    expect(opened.reused).toBeTrue()
    expect(chrome.created).toBe(1)
  })

  test("recovers a sent reservation before applying a new route and server origin", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.deferCreatedTarget = true
    chrome.throwAfterCreate = true
    await expect(createController(chrome, root).openPackage(openInput(chrome)))
      .rejects.toThrow("simulated owner crash")
    const next = {
      ...openInput(chrome),
      origin: "http://127.0.0.1:44123",
      route: "fixture/a/alternate",
      url: "http://127.0.0.1:44123/packages/%40fixture%2Fa/fixture/a/alternate",
    }

    chrome.throwAfterCreate = false
    await expect(createController(chrome, root).openPackage(next))
      .rejects.toThrow("target creation is indeterminate")
    expect(chrome.created).toBe(1)

    chrome.materializeCreatedTarget()
    const opened = await createController(chrome, root).openPackage(next)
    expect(opened.reused).toBeTrue()
    expect(opened.identity.route).toBe("fixture/a/alternate")
    expect(chrome.created).toBe(1)
  })

  test("reuses a recorded provisional target before its URL commits", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    new StorybookBrowserState(join(root, "state")).writeTarget({
      packageId: "@fixture/a",
      cdpOrigin: chrome.cdp,
      browserIdentity: "a".repeat(64),
      targetId: chrome.targetId,
    })
    chrome.targetsValue = [{
      targetId: chrome.targetId,
      type: "page",
      title: "Pending",
      url: "about:blank",
    }]

    const opened = await createController(chrome, root).openPackage(openInput(chrome))

    expect(opened.reused).toBeTrue()
    expect(chrome.created).toBe(0)
    expect(chrome.navigations).toBe(1)
  })

  test("reattests a duplicate immediately before close and preserves a tab navigated away by the user", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "A", url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default"},
      {targetId: "OLD_B", type: "page", title: "B", url: "http://127.0.0.1:42000/packages/%40fixture%2Fa/fixture/a/default"},
    ]
    chrome.foreignizeOnWaitReady = "OLD_B"

    await createController(chrome).openPackage(openInput(chrome))

    expect(chrome.closed).toEqual([])
    expect(chrome.targetsValue).toContainEqual(expect.objectContaining({
      targetId: "OLD_B",
      url: "https://example.com/user-page",
    }))
  })

  test("reattests an exact view before explicit close and preserves a user-navigated tab", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage(openInput(chrome))
    chrome.foreignTargetIds.add(chrome.targetId)
    chrome.targetsValue = chrome.targetsValue.map((target) => target.targetId === chrome.targetId
      ? {...target, url: "https://example.com/user-page"}
      : target)

    expect(await controller.close(opened.view.viewId)).toEqual({
      closed: false,
      viewId: opened.view.viewId,
      preserved: true,
    })
    expect(chrome.closed).toEqual([])
  })

  test("keeps ownership when exact-target attestation is temporarily unavailable", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage(openInput(chrome))
    chrome.foreignTargetIds.add(chrome.targetId)

    await expect(controller.close(opened.view.viewId))
      .rejects.toThrow("target attestation is indeterminate")
    chrome.foreignTargetIds.delete(chrome.targetId)
    const reused = await controller.openPackage(openInput(chrome))
    expect(reused.reused).toBeTrue()
    expect(chrome.created).toBe(1)
  })

  test("preserves a recorded target navigated to a foreign page and creates one replacement", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    await controller.openPackage(openInput(chrome))
    chrome.foreignTargetIds.add(chrome.targetId)
    chrome.targetsValue = chrome.targetsValue.map((target) => target.targetId === chrome.targetId
      ? {...target, url: "https://example.com/user-page"}
      : target)

    const opened = await controller.openPackage(openInput(chrome))

    expect(opened.reused).toBeFalse()
    expect(chrome.created).toBe(2)
    expect(chrome.targetsValue).toContainEqual(expect.objectContaining({
      targetId: chrome.targetId,
      url: "https://example.com/user-page",
    }))
  })

  test("serializes independent controllers and preserves the opaque view identity", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const first = createController(chrome, root)
    const second = createController(chrome, root)

    const [left, right] = await Promise.all([
      first.openPackage(openInput(chrome)),
      second.openPackage(openInput(chrome)),
    ])

    expect(chrome.created).toBe(1)
    expect(left.view.viewId).toBe(right.view.viewId)
    expect([left.reused, right.reused].sort()).toEqual([false, true])
  })

  test("treats route changes as navigation of the same package target", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const first = await controller.openPackage(openInput(chrome))
    const second = await controller.openPackage({
      ...openInput(chrome),
      route: "fixture/a/alternate",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/alternate`,
    })

    expect(second.reused).toBeTrue()
    expect(second.view.viewId).toBe(first.view.viewId)
    expect(second.view.route).toBe("fixture/a/alternate")
    expect(chrome.created).toBe(1)
  })

  test("normalizes attested physical duplicates before listing logical views", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Old", url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`},
    ]
    const views = await createController(chrome).listViews(chrome.origin)

    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({packageId: "@fixture/a"})
    expect(chrome.closed).toEqual(["OLD_A"])
  })

  test("fails closed when an exact duplicate cannot be reattested", async () => {
    const chrome = new FakeChrome()
    chrome.foreignTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Old", url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`},
    ]

    await expect(createController(chrome).listViews(chrome.origin))
      .rejects.toThrow("duplicate package target attestation is indeterminate")
    expect(chrome.closed).toEqual([])
  })

  test("normalizes an exact named legacy duplicate without modern package markers", async () => {
    const chrome = new FakeChrome()
    chrome.legacyTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Old", url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`},
    ]

    const views = await createController(chrome).listViews(chrome.origin)
    expect(views).toHaveLength(1)
    expect(chrome.closed).toEqual(["OLD_A"])
  })

  test("normalizes an exact marker-owned legacy duplicate without window name", async () => {
    const chrome = new FakeChrome()
    chrome.markerOnlyTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Old", url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`},
    ]

    const views = await createController(chrome).listViews(chrome.origin)
    expect(views).toHaveLength(1)
    expect(chrome.closed).toEqual(["OLD_A"])
  })

  test("normalizes an exact canonical-title legacy error document", async () => {
    const chrome = new FakeChrome()
    chrome.titleOnlyTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Fixture A", url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`},
    ]

    const views = await createController(chrome).listViews(chrome.origin, undefined, [{
      packageId: "@fixture/a",
      label: "Fixture A",
    }])
    expect(views).toHaveLength(1)
    expect(chrome.closed).toEqual(["OLD_A"])
  })

  test("normalizes an exact canonical-title target when diagnostics are unavailable", async () => {
    const chrome = new FakeChrome()
    chrome.unavailableDiagnosticsTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Fixture A", url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`},
    ]

    const views = await createController(chrome).listViews(chrome.origin, undefined, [{
      packageId: "@fixture/a",
      label: "Fixture A",
    }])
    expect(views).toHaveLength(1)
    expect(chrome.closed).toEqual(["OLD_A"])
  })

  test("does not let another package's legacy duplicates block an exact open", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "B1", type: "page", title: "B1", url: "http://127.0.0.1:41000/packages/%40fixture%2Fb/"},
      {targetId: "B2", type: "page", title: "B2", url: "http://127.0.0.1:42000/packages/%40fixture%2Fb/"},
    ]
    const opened = await createController(chrome).openPackage(openInput(chrome))

    expect(opened.identity.packageId).toBe("@fixture/a")
    expect(chrome.created).toBe(1)
    expect(chrome.closed).toEqual([])
  })

  test("captures bridge-selected preview crop into a bounded artifact", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
    })
    const capture = await controller.capture({
      viewId: opened.view.viewId,
      area: "preview",
      failOnConsoleError: true,
    })
    expect(capture).toMatchObject({
      packageId: "@fixture/a",
      route: "fixture/a/default",
      width: 2,
      height: 3,
      area: "preview",
    })
    expect(capture.resourceUri).toBe(`storybook://captures/${capture.captureId}`)
    expect(Buffer.from(capture.image.data, "base64")).toEqual(Buffer.from(fakePng(2, 3)))
    expect(chrome.lastClip).toEqual({x: 10, y: 20, width: 200, height: 100})
  })

  test("captures page, Workbench, canvas and semantic-node areas with exact revision metadata", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
    })
    for (const area of ["page", "workbench", "canvas", "node"] as const) {
      const capture = await controller.capture({
        viewId: opened.view.viewId,
        area,
        ...(area === "node" ? {nodeId: "node:1"} : {}),
        failOnConsoleError: true,
      })
      expect(capture).toMatchObject({
        packageId: "@fixture/a",
        route: "fixture/a/default",
        revision: "revision-a",
        graphDigest: "a".repeat(64),
        area,
        width: 2,
        height: 3,
      })
    }
  })

  test("fails closed when window.name or browser markers disagree with the bridge", async () => {
    const chrome = new FakeChrome()
    chrome.invalidIdentity = true
    const controller = createController(chrome)
    await expect(controller.openPackage({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
      foreground: true,
    })).rejects.toThrow("window.name")
    expect(chrome.activated).toEqual([])
  })

  test("waits for the package bridge after document readiness", async () => {
    const chrome = new FakeChrome()
    chrome.unavailableBridgeCalls = 2
    const controller = createController(chrome)
    const opened = await controller.openPackage({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
      timeoutMs: 1_000,
    })
    expect(opened.identity.ready).toBeTrue()
    expect(chrome.identityCalls).toBeGreaterThanOrEqual(3)
  })

  test("reloads the exact view until the event-selected revision is presented", async () => {
    const chrome = new FakeChrome()
    chrome.identityRevision = "revision-old"
    chrome.revisionAfterNavigate = "revision-next"
    const controller = createController(chrome)
    const opened = await controller.openPackage({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
      expectedRevision: "revision-next",
    })
    expect(opened.identity.revision).toBe("revision-next")
    expect(chrome.navigations).toBe(1)
  })

  test("bounds the whole open and interaction operations by their public timeout", async () => {
    const hangingHealth = new FakeChrome()
    hangingHealth.hangHealth = true
    const healthController = createController(hangingHealth)
    await expect(healthController.openPackage({
      origin: hangingHealth.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${hangingHealth.origin}/packages/%40fixture%2Fa/fixture/a/default`,
      timeoutMs: 100,
    })).rejects.toMatchObject({name: "TimeoutError"})

    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
    })
    chrome.hangBridgeMethod = "interact"
    await expect(controller.interact({
      viewId: opened.view.viewId,
      target: {nodeId: "node:1"},
      action: "click",
      timeoutMs: 100,
    })).rejects.toMatchObject({name: "TimeoutError"})
  })
})

class FakeChrome implements StorybookChromeClient {
  readonly origin = "http://127.0.0.1:43123"
  readonly cdp = "http://127.0.0.1:9222"
  readonly targetId = "PRIVATE_TARGET"
  targetsValue: ChromeTargetSummary[] = []
  readonly foreignTargetIds = new Set<string>()
  readonly legacyTargetIds = new Set<string>()
  readonly markerOnlyTargetIds = new Set<string>()
  readonly titleOnlyTargetIds = new Set<string>()
  readonly unavailableDiagnosticsTargetIds = new Set<string>()
  readonly closed: string[] = []
  readonly activated: string[] = []
  readonly targetOperations: string[] = []
  created = 0
  lastClip: unknown
  invalidIdentity = false
  unavailableBridgeCalls = 0
  identityCalls = 0
  identityRevision = "revision-a"
  revisionAfterNavigate: string | null = null
  navigations = 0
  hangHealth = false
  hangBridgeMethod: StorybookBridgeMethod | null = null
  foreignizeOnWaitReady: string | null = null
  throwAfterCreate = false
  deferCreatedTarget = false
  pendingTarget: ChromeTargetSummary | null = null

  async health(signal?: AbortSignal): Promise<void> {
    if (this.hangHealth) await hangUntilAbort(signal)
  }
  async cdpOrigin(): Promise<string> {
    return this.cdp
  }
  async browserIdentity(): Promise<string> {
    return "a".repeat(64)
  }
  async targets(): Promise<readonly ChromeTargetSummary[]> {
    return this.targetsValue
  }
  async createTarget(url: string): Promise<ChromeTargetSummary> {
    this.created += 1
    const target = {
      targetId: this.created === 1 ? this.targetId : `${this.targetId}_${this.created}`,
      type: "page",
      title: "Fixture",
      url,
    }
    if (this.deferCreatedTarget) this.pendingTarget = target
    else this.targetsValue.push(target)
    if (this.throwAfterCreate) throw new Error("simulated owner crash")
    return target
  }
  materializeCreatedTarget(): void {
    if (this.pendingTarget === null) throw new Error("No pending target")
    this.targetsValue.push(this.pendingTarget)
    this.pendingTarget = null
  }
  async activateTarget(targetId: string): Promise<void> {
    this.activated.push(targetId)
    this.targetOperations.push(`activate:${targetId}`)
  }
  async closeTarget(targetId: string): Promise<void> {
    this.closed.push(targetId)
    this.targetOperations.push(`close:${targetId}`)
    this.targetsValue = this.targetsValue.filter((target) => target.targetId !== targetId)
  }
  async navigate(_targetId: string, url: string): Promise<void> {
    this.navigations += 1
    if (this.revisionAfterNavigate !== null) this.identityRevision = this.revisionAfterNavigate
    this.targetsValue = this.targetsValue.map((target) => ({...target, url}))
  }
  async waitReady(): Promise<void> {
    if (this.foreignizeOnWaitReady === null) return
    const targetId = this.foreignizeOnWaitReady
    this.foreignizeOnWaitReady = null
    this.foreignTargetIds.add(targetId)
    this.targetsValue = this.targetsValue.map((target) => target.targetId === targetId
      ? {...target, url: "https://example.com/user-page"}
      : target)
  }
  async consoleEntries(): Promise<readonly []> {
    return []
  }
  async bridgeDiagnostics(targetId: string): Promise<Readonly<Record<string, unknown>>> {
    if (this.unavailableDiagnosticsTargetIds.has(targetId)) {
      throw new Error("diagnostics unavailable")
    }
    if (this.legacyTargetIds.has(targetId)) {
      return Object.freeze({
        readyState: "complete",
        bridge: "undefined",
        viewName: "storybook:@fixture/a",
        markers: {packageId: null},
      })
    }
    if (this.markerOnlyTargetIds.has(targetId)) {
      return Object.freeze({
        readyState: "complete",
        bridge: "undefined",
        viewName: "",
        markers: {packageId: "@fixture/a"},
      })
    }
    if (this.titleOnlyTargetIds.has(targetId)) {
      return Object.freeze({
        readyState: "complete",
        bridge: "undefined",
        viewName: "",
        markers: {},
      })
    }
    if (this.foreignTargetIds.has(targetId)) {
      return Object.freeze({readyState: "complete", bridge: "undefined", viewName: "foreign", markers: {}})
    }
    return Object.freeze({readyState: "complete", bridge: "undefined"})
  }
  async callBridge(
    targetId: string,
    method: StorybookBridgeMethod,
    _params?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.hangBridgeMethod === method) await hangUntilAbort(signal)
    if (this.foreignTargetIds.has(targetId)) {
      throw new Error("Storybook agent bridge is unavailable in the exact target")
    }
    if (this.legacyTargetIds.has(targetId) || this.markerOnlyTargetIds.has(targetId) ||
      this.titleOnlyTargetIds.has(targetId) || this.unavailableDiagnosticsTargetIds.has(targetId)) {
      throw new Error("Storybook agent bridge is unavailable in the exact target")
    }
    if (method === "identity") {
      this.identityCalls += 1
      this.targetOperations.push(`identity:${targetId}`)
      if (this.identityCalls <= this.unavailableBridgeCalls) {
        throw new Error("Storybook agent bridge is unavailable in the exact target")
      }
      const current = this.targetsValue.find(({targetId: candidate}) => candidate === targetId)
      const target = current === undefined
        ? {packageId: "@fixture/a", route: "fixture/a/default"}
        : targetIdentity(current.url)
      return {
      protocol: "external-storybook-agent-bridge/1",
      packageId: target.packageId,
      route: target.route,
      revision: this.identityRevision,
      graphDigest: "a".repeat(64),
      ready: true,
      presented: true,
      timeOrigin: 42,
      viewName: this.invalidIdentity ? "storybook:@fixture/other" : `storybook:${target.packageId}`,
      markers: {
        package: "ready",
        packageId: target.packageId,
        route: target.route,
        revision: this.identityRevision,
      },
      }
    }
    if (method === "capture") return {clip: {x: 10, y: 20, width: 200, height: 100}}
    return {ok: true}
  }
  async screenshot(
    _targetId: string,
    options: Readonly<{clip?: unknown}>,
  ): Promise<Uint8Array> {
    this.lastClip = options.clip
    return fakePng(2, 3)
  }
}

function targetIdentity(value: string): Readonly<{packageId: string; route: string}> {
  const url = new URL(value)
  const segments = url.pathname.split("/")
  return Object.freeze({
    packageId: decodeURIComponent(segments[2]!),
    route: segments.slice(3).filter(Boolean).map(decodeURIComponent).join("/"),
  })
}

function createController(chrome: StorybookChromeClient, root = temporaryRoot()): StorybookBrowserLifecycle {
  return createStorybookBrowserLifecycle({
    chrome,
    captureRoot: join(root, "captures"),
    stateRoot: join(root, "state"),
  })
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-browser-controller-"))
  roots.push(root)
  return root
}

function openInput(chrome: FakeChrome) {
  return {
    origin: chrome.origin,
    packageId: "@fixture/a",
    route: "fixture/a/default",
    url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
  }
}

function fakePng(width: number, height: number): Uint8Array {
  const image = new PNG({width, height})
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const pixel = offset / 4
    image.data[offset] = pixel % 2 === 0 ? 30 : 210
    image.data[offset + 1] = 90
    image.data[offset + 2] = 160
    image.data[offset + 3] = 255
  }
  return new Uint8Array(PNG.sync.write(image))
}

async function hangUntilAbort(signal?: AbortSignal): Promise<never> {
  if (signal?.aborted) throw signal.reason
  return new Promise<never>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {once: true})
  })
}
