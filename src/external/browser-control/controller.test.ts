import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {PNG} from "pngjs"
import {StorybookBrowserController} from "./controller.ts"
import {StorybookCaptureStore} from "./capture-store.ts"
import {StorybookBrowserState} from "./browser-state.ts"
import type {StorybookChromeClient} from "./chrome-client.ts"
import type {ChromeTargetSummary, StorybookBridgeMethod} from "./types.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("Storybook browser controller", () => {
  test("reuses one package view and never returns the CDP target identity", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const input = {
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
    }
    const first = await controller.open(input)
    const second = await controller.open(input)
    expect(first.reused).toBeFalse()
    expect(second.reused).toBeTrue()
    expect(chrome.created).toBe(1)
    expect(first.view.viewId).toBe(second.view.viewId)
    expect(JSON.stringify(first)).not.toContain(chrome.targetId)
    expect(JSON.stringify(first.view)).not.toContain("43123")
    expect(first.view).not.toHaveProperty("origin")
    expect(first.view).not.toHaveProperty("url")
  })

  test("adopts an attested package target from the previous server origin", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [{
      targetId: "OLD_TARGET",
      type: "page",
      title: "Old Storybook",
      url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default",
    }]
    const opened = await createController(chrome).open(openInput(chrome))

    expect(opened.reused).toBeTrue()
    expect(chrome.created).toBe(0)
    expect(chrome.navigations).toBe(1)
    expect(chrome.targetsValue).toEqual([expect.objectContaining({
      targetId: "OLD_TARGET",
      url: openInput(chrome).url,
    })])
  })

  test("closes only attested duplicates after the retained target is ready", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "A", url: "http://127.0.0.1:41000/packages/%40fixture%2Fa/fixture/a/default"},
      {targetId: "OLD_B", type: "page", title: "B", url: "http://127.0.0.1:42000/packages/%40fixture%2Fa/fixture/a/default"},
    ]
    const opened = await createController(chrome).open(openInput(chrome))

    expect(opened.reused).toBeTrue()
    expect(chrome.closed).toEqual(["OLD_B"])
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
    const opened = await createController(chrome).open(openInput(chrome))

    expect(opened.reused).toBeFalse()
    expect(chrome.created).toBe(1)
    expect(chrome.closed).toEqual([])
    expect(chrome.targetsValue.map(({targetId}) => targetId)).toEqual(["FOREIGN", chrome.targetId])
  })

  test("persists provisional ownership when the first bridge readiness attempt fails", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.unavailableBridgeCalls = Number.MAX_SAFE_INTEGER
    await expect(createController(chrome, root).open({...openInput(chrome), timeoutMs: 100}))
      .rejects.toMatchObject({name: "TimeoutError"})

    chrome.unavailableBridgeCalls = 0
    const opened = await createController(chrome, root).open(openInput(chrome))

    expect(opened.reused).toBeTrue()
    expect(chrome.created).toBe(1)
  })

  test("reuses a recorded provisional target before its URL commits", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    new StorybookBrowserState(join(root, "state")).writeTarget({
      packageId: "@fixture/a",
      cdpOrigin: chrome.cdp,
      targetId: chrome.targetId,
    })
    chrome.targetsValue = [{
      targetId: chrome.targetId,
      type: "page",
      title: "Pending",
      url: "about:blank",
    }]

    const opened = await createController(chrome, root).open(openInput(chrome))

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

    await createController(chrome).open(openInput(chrome))

    expect(chrome.closed).toEqual([])
    expect(chrome.targetsValue).toContainEqual(expect.objectContaining({
      targetId: "OLD_B",
      url: "https://example.com/user-page",
    }))
  })

  test("serializes independent controllers and preserves the opaque view identity", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const first = createController(chrome, root)
    const second = createController(chrome, root)

    const [left, right] = await Promise.all([
      first.open(openInput(chrome)),
      second.open(openInput(chrome)),
    ])

    expect(chrome.created).toBe(1)
    expect(left.view.viewId).toBe(right.view.viewId)
    expect([left.reused, right.reused].sort()).toEqual([false, true])
  })

  test("captures bridge-selected preview crop into a bounded artifact", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.open({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
    })
    const capture = await controller.capture({
      schemaVersion: 1,
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
    const opened = await controller.open({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
    })
    for (const area of ["page", "workbench", "canvas", "node"] as const) {
      const capture = await controller.capture({
        schemaVersion: 1,
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
    await expect(controller.open({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
    })).rejects.toThrow("window.name")
  })

  test("waits for the package bridge after document readiness", async () => {
    const chrome = new FakeChrome()
    chrome.unavailableBridgeCalls = 2
    const controller = createController(chrome)
    const opened = await controller.open({
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
    const opened = await controller.open({
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
    await expect(healthController.open({
      origin: hangingHealth.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${hangingHealth.origin}/packages/%40fixture%2Fa/fixture/a/default`,
      timeoutMs: 100,
    })).rejects.toMatchObject({name: "TimeoutError"})

    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.open({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/packages/%40fixture%2Fa/fixture/a/default`,
    })
    chrome.hangBridgeMethod = "interact"
    await expect(controller.interact({
      schemaVersion: 1,
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
  readonly closed: string[] = []
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

  async health(signal?: AbortSignal): Promise<void> {
    if (this.hangHealth) await hangUntilAbort(signal)
  }
  async cdpOrigin(): Promise<string> {
    return this.cdp
  }
  async targets(): Promise<readonly ChromeTargetSummary[]> {
    return this.targetsValue
  }
  async createTarget(url: string): Promise<ChromeTargetSummary> {
    this.created += 1
    const target = {targetId: this.targetId, type: "page", title: "Fixture", url}
    this.targetsValue.push(target)
    return target
  }
  async closeTarget(targetId: string): Promise<void> {
    this.closed.push(targetId)
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
    if (method === "identity") {
      this.identityCalls += 1
      if (this.identityCalls <= this.unavailableBridgeCalls) {
        throw new Error("Storybook agent bridge is unavailable in the exact target")
      }
      return {
      protocol: "external-storybook-agent-bridge/1",
      packageId: "@fixture/a",
      route: "fixture/a/default",
      revision: this.identityRevision,
      graphDigest: "a".repeat(64),
      ready: true,
      presented: true,
      timeOrigin: 42,
      viewName: this.invalidIdentity ? "storybook:@fixture/other" : "storybook:@fixture/a",
      markers: {
        package: "ready",
        packageId: "@fixture/a",
        route: "fixture/a/default",
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

function createController(chrome: StorybookChromeClient, root = temporaryRoot()): StorybookBrowserController {
  return new StorybookBrowserController({
    chrome,
    captures: new StorybookCaptureStore({root: join(root, "captures")}),
    state: new StorybookBrowserState(join(root, "state")),
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
