import createAgentBridge, {type StorybookAppWebPageAgentBridge} from "@zavx0z/storybook-app-web-page-agent-bridge"
import {createDocument} from "@zavx0z/immersive"
import routeUrl from "@zavx0z/storybook-package-route-url"
import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {PNG} from "pngjs"
import {StorybookBrowserState} from "../src/browser-state.ts"
import type {ChromeTargetSummary, StorybookBridgeMethod, StorybookChromeClient, StorybookChromeConsoleEntry} from "../contract/types"
import createStorybookBrowserLifecycle, {type StorybookAppServerBrowser} from "../index.ts"

const {storybookPackageRouteFromPathname} = routeUrl
type StorybookBrowserLifecycle = StorybookAppServerBrowser.Output

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("Storybook browser lifecycle service", () => {
  test("Browser принимает настоящую identity AgentBridge для общего пространства", async () => {
    const chrome = new FakeChrome()
    const semanticDocument = createDocument()
    const space = semanticDocument.createElement("div")
    semanticDocument.append(space)
    let selectedPackage: string | null = "@fixture/a"
    let route = openInput(chrome).route
    let revision: string | null = "revision-a"
    const dataset: Record<string, string> = {
      externalStorybookPackage: "ready", externalStorybookPackageId: selectedPackage,
      externalStorybookRoute: route, externalStorybookRevision: revision,
    }
    const nativeDocument = {
      documentElement: {dataset}, defaultView: {name: "storybook:workspace"},
      location: new URL(openInput(chrome).url), visibilityState: "visible", hasFocus: () => true,
    }
    let presentedFrame = 1
    const shell = {
      document: semanticDocument, browserDocument: nativeDocument,
      canvas: {id: "shared-canvas", width: 800, height: 600, hidden: false, getBoundingClientRect: () => ({left: 5, top: 6, width: 800, height: 600})},
      space, workbench: {element: space, elements: {previewHost: space}},
      get presentedFrameSequence() {return presentedFrame},
      presentFrame() {return ++presentedFrame}, followEnvironment: false,
      projectionFor: () => ({kind: "space"}),
    } as unknown as StorybookAppWebPageAgentBridge.Input["shell"]
    const bridge = createAgentBridge({
      packageId: selectedPackage, revision, graphDigest: "a".repeat(64), shell,
      getRoute: () => route,
      getModel: () => selectedPackage === null ? null : {selectedNode: {id: selectedPackage, kind: "directory"}, tabActiveId: "overview"},
      navigate: async () => {}, applyRevision: async () => {},
      async navigateWorkspace(input) {
        selectedPackage = input.packageId
        route = input.route
        revision = selectedPackage === null ? null : input.revision ?? "revision-b"
        nativeDocument.location = new URL(input.url!, chrome.origin)
        chrome.targetsValue = chrome.targetsValue.map(target => ({...target, url: nativeDocument.location.href}))
        dataset.externalStorybookRoute = route
        if (selectedPackage === null) {delete dataset.externalStorybookPackageId; delete dataset.externalStorybookRevision}
        else {dataset.externalStorybookPackageId = selectedPackage; dataset.externalStorybookRevision = revision!}
        bridge.updateIdentity(selectedPackage, revision, "a".repeat(64))
      },
    })
    chrome.callBridge = async (_target, method, params, signal) => {signal?.throwIfAborted(); return bridge.call(method, params)}
    try {
      const controller = createController(chrome)
      const first = await controller.openPackage(openInput(chrome))
      const second = await controller.openPackage({...openInput(chrome), packageId: "@fixture/b", route: "", url: `${chrome.origin}/pkg-fixture-b/`})
      const landing = await controller.openPackage({origin: chrome.origin, packageId: null, route: "", url: `${chrome.origin}/`})
      expect(first.identity.viewName).toBe("storybook:workspace")
      expect(second.identity).toMatchObject({packageId: "@fixture/b", viewName: "storybook:workspace", timeOrigin: first.identity.timeOrigin})
      expect(landing.identity).toMatchObject({packageId: null, revision: null, route: "", viewName: "storybook:workspace", timeOrigin: first.identity.timeOrigin})
      for (const area of ["page", "canvas"] as const) {
        const capture = await controller.capture({viewId: landing.view.viewId, area})
        expect(capture).toMatchObject({packageId: null, revision: null, route: "", graphDigest: "a".repeat(64), area, width: 2, height: 3})
        expect(controller.readCapture(capture.captureId).metadata).toMatchObject({packageId: null, revision: null, route: "", area})
      }
      expect(chrome.lastClip).toEqual({x: 5, y: 6, width: 800, height: 600, scale: 1})
      expect(chrome.created).toBe(1)
      expect(chrome.navigations).toBe(0)
      nativeDocument.defaultView.name = "storybook:foreign"
      await expect(controller.currentWorkspace(chrome.origin)).rejects.toThrow("window.name")
    } finally {bridge.dispose()}
  })

  test("landing node capture сохраняет null identity и отклоняет старый handle", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const landing = await controller.openPackage({origin: chrome.origin, packageId: null, route: "", url: `${chrome.origin}/`})
    const original = chrome.callBridge.bind(chrome)
    let captured = 0
    chrome.callBridge = async (target, method, params, signal) => {
      if (method === "capture") {
        expect(params).toMatchObject({expectedPackageId: null, area: "node", nodeId: "root-node"})
        captured += 1
      }
      return original(target, method, params, signal)
    }
    expect(await controller.capture({viewId: landing.view.viewId, area: "node", nodeId: "root-node"})).toMatchObject({packageId: null, revision: null, route: "", nodeId: "root-node"})
    await controller.openPackage(openInput(chrome))
    await expect(controller.capture({viewId: landing.view.viewId, area: "node", nodeId: "root-node"})).rejects.toThrow("Unknown")
    expect(captured).toBe(1)
    expect(chrome.created).toBe(1)
  })

  test.each(["before", "during"])("landing capture отклоняет пользовательский переход %s screenshot", async phase => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const landing = await controller.openPackage({origin: chrome.origin, packageId: null, route: "", url: `${chrome.origin}/`})
    const move = () => {chrome.targetsValue = chrome.targetsValue.map(target => ({...target, url: openInput(chrome).url}))}
    let screenshots = 0
    const screenshot = chrome.screenshot.bind(chrome)
    chrome.screenshot = async (...args) => {screenshots += 1; if (phase === "during") move(); return screenshot(...args)}
    if (phase === "before") move()
    await expect(controller.capture({viewId: landing.view.viewId, area: "page"})).rejects.toThrow("navigated")
    expect(screenshots).toBe(phase === "before" ? 0 : 1)
    expect(chrome.created).toBe(1)
  })

  test("package capture требует настоящую ревизию", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage(openInput(chrome))
    const original = chrome.callBridge.bind(chrome)
    chrome.callBridge = async (target, method, params, signal) => {
      const result = await original(target, method, params, signal) as {markers?: object}
      return method === "identity" ? {...result, revision: null, markers: {...result.markers, revision: null}} : result
    }
    await expect(controller.capture({viewId: opened.view.viewId, area: "page"})).rejects.toThrow("not ready and presented")
  })

  test.each([false, true])("имя пакета принимается только у legacy bridge, modern=%s", async modern => {
    const chrome = new FakeChrome()
    chrome.inPageNavigation = modern
    const original = chrome.callBridge.bind(chrome)
    chrome.callBridge = async (target, method, params, signal) => {
      const result = await original(target, method, params, signal)
      return method === "identity" ? {...result as object, viewName: "storybook:@fixture/a"} : result
    }
    const controller = createController(chrome)
    if (modern) await expect(controller.openPackage(openInput(chrome))).rejects.toThrow("window.name")
    else expect((await controller.openPackage(openInput(chrome))).identity.packageId).toBe("@fixture/a")
    expect(chrome.created).toBe(1)
  })

  test.each([false, true])("native recovery не понижает записанное имя workspace до legacy, modern=%s", async modern => {
    const chrome = new FakeChrome()
    chrome.inPageNavigation = modern
    const controller = createController(chrome)
    const initial = await controller.openPackage(openInput(chrome))
    chrome.hangBridgeMethod = "identity"
    chrome.bridgeDiagnostics = async () => ({viewName: "storybook:@fixture/a", markers: {packageId: "@fixture/a"}})
    const navigate = chrome.navigate.bind(chrome)
    chrome.navigate = async (target, url) => {chrome.hangBridgeMethod = null; await navigate(target, url)}
    if (modern) {
      await expect(controller.openPackage({...openInput(chrome), recover: true, timeoutMs: 600})).rejects.toThrow("ownership is indeterminate")
      expect(chrome.navigations).toBe(0)
    } else {
      expect((await controller.openPackage({...openInput(chrome), recover: true, timeoutMs: 600})).view).toEqual(initial.view)
      expect(chrome.navigations).toBe(1)
    }
    expect(chrome.created).toBe(1)
  })

  test("переходы пакетов и Project сохраняют один target и realm", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const first = createController(chrome, root)
    const second = createController(chrome, root)
    const a = await first.openPackage(openInput(chrome))
    const b = await second.openPackage({...openInput(chrome), packageId: "@fixture/b", route: "example", url: `${chrome.origin}/pkg-fixture-b/example`})
    expect(b.identity.timeOrigin).toBe(a.identity.timeOrigin)
    expect(b.view.viewId).not.toBe(a.view.viewId)
    expect(await first.listViews(chrome.origin, undefined, undefined, "@fixture/a")).toEqual([])
    await expect(first.interact({viewId: a.view.viewId, action: "click", target: {nodeId: "old"}})).rejects.toThrow("Unknown")
    const landing = await first.openPackage({origin: chrome.origin, packageId: null, route: "", url: `${chrome.origin}/`})
    expect(landing.identity).toMatchObject({packageId: null, route: "", revision: null, timeOrigin: a.identity.timeOrigin})
    expect((await second.currentWorkspace(chrome.origin))?.view).toEqual(landing.view)
    await second.openPackage(openInput(chrome))
    expect(chrome.created).toBe(1)
    expect(chrome.navigations).toBe(0)
    expect(chrome.bridgeNavigations).toBe(3)
    expect(chrome.closed).toEqual([])
  })

  test("конкурентные opens разных предметов используют одну reservation", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const [a, b] = await Promise.all([
      createController(chrome, root).openPackage(openInput(chrome)),
      createController(chrome, root).openPackage({...openInput(chrome), packageId: "@fixture/b", route: "", url: `${chrome.origin}/pkg-fixture-b/`}),
    ])
    expect(a.view.packageId).toBe("@fixture/a")
    expect(b.view.packageId).toBe("@fixture/b")
    expect(chrome.created).toBe(1)
    expect(chrome.navigations).toBe(0)
    expect(chrome.bridgeNavigations).toBe(1)
  })

  test("первое принятие выбирает сфокусированное пространство, legacy peers сохраняются", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "A", url: `${chrome.origin}/pkg-fixture-a/`},
      {targetId: "FOCUSED_B", type: "page", title: "B", url: `${chrome.origin}/pkg-fixture-b/`},
    ]
    chrome.focusedTarget = "FOCUSED_B"
    const controller = createController(chrome)
    expect((await controller.currentWorkspace(chrome.origin))?.view.packageId).toBe("@fixture/b")
    chrome.focusedTarget = "OLD_A"
    expect((await controller.currentWorkspace(chrome.origin))?.view.packageId).toBe("@fixture/b")
    const opened = await controller.openPackage(openInput(chrome))
    expect(opened.view.packageId).toBe("@fixture/a")
    expect(chrome.targetsValue.find(target => target.targetId === "OLD_A")?.url).toBe(`${chrome.origin}/pkg-fixture-a/`)
    expect(chrome.created).toBe(0)
    expect(chrome.navigations).toBe(0)
    expect(chrome.closed).toEqual([])
  })

  test("legacy bridge обновляется один раз в существующем target", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const first = await controller.openPackage(openInput(chrome))
    chrome.inPageNavigation = false
    const native = chrome.navigate.bind(chrome)
    chrome.navigate = async (target, url) => {await native(target, url); chrome.inPageNavigation = true}
    await controller.openPackage({...openInput(chrome), packageId: "@fixture/b", route: "", url: `${chrome.origin}/pkg-fixture-b/`})
    await expect(controller.interact({viewId: first.view.viewId, action: "click"})).rejects.toThrow("Unknown")
    await controller.openPackage(openInput(chrome))
    expect(chrome.created).toBe(1)
    expect(chrome.navigations).toBe(1)
    expect(chrome.navigatedTargets).toEqual([chrome.targetId])
    expect(chrome.bridgeNavigations).toBe(1)
  })

  test("следование окружению проверяет toggle перед переходом", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const original = await controller.openPackage(openInput(chrome))
    const input = {...openInput(chrome), packageId: "@fixture/b", route: "", url: `${chrome.origin}/pkg-fixture-b/`, followEnvironment: true as const}
    await expect(controller.openPackage(input)).rejects.toThrow("following was disabled")
    expect(chrome.bridgeNavigations).toBe(0)
    chrome.followEnvironment = true
    const bridge = chrome.callBridge.bind(chrome)
    chrome.callBridge = async (target, method, params, signal) => {
      if (method === "navigate") chrome.followEnvironment = false
      return bridge(target, method, params, signal)
    }
    await expect(controller.openPackage(input)).rejects.toThrow("following was disabled")
    expect((await controller.currentWorkspace(chrome.origin))?.view).toEqual(original.view)
    expect(chrome.bridgeNavigations).toBe(0)
    expect(chrome.navigations).toBe(0)
  })

  test.each([false, true])("структурный адрес требует точную identity bridge, mismatch=%s", async mismatch => {
    const chrome = new FakeChrome()
    const original = chrome.callBridge.bind(chrome)
    chrome.callBridge = async (target, method, params, signal) => {
      const result = await original(target, method, params, signal)
      if (method !== "identity") return result
      const packageId = mismatch ? "@fixture/b" : "@fixture/a"
      const route = "diagram/scenarios"
      return {...result as object, packageId, route, viewName: "storybook:workspace",
        markers: {package: "ready", packageId, route, revision: chrome.identityRevision}}
    }
    const controller = createController(chrome)
    const input = {...openInput(chrome), route: "diagram/scenarios",
      url: `${chrome.origin}/immersive/nodes/node/diagram?view=scenarios&variant=Круг`}
    if (mismatch) await expect(controller.openPackage(input)).rejects.toThrow("bridge identity mismatch")
    else {
      const opened = await controller.openPackage(input)
      expect(opened.view).toMatchObject({packageId: "@fixture/a", route: "diagram/scenarios"})
      expect(await controller.listViews(chrome.origin, undefined, [{packageId: "@fixture/a", label: "A"}]))
        .toEqual([opened.view])
    }
  })

  test.each([false, true])("история консоли отделяется от ошибок обновления, newError=%s", async newError => {
    const chrome = new FakeChrome()
    const original = chrome.callBridge.bind(chrome)
    chrome.callBridge = async (target, method, params, signal) => {
      if (method === "applyRevision") chrome.identityRevision = (params as {revision: string}).revision
      const result = await original(target, method === "applyRevision" ? "identity" : method, params, signal)
      return method === "identity" || method === "applyRevision"
        ? {...result as object, capabilities: {inPageUpdates: true}}
        : result
    }
    chrome.consoleEntries = async () => [
      {source: "console", type: "error", level: "error", text: "old", timestamp: 1},
      ...(newError && chrome.identityRevision === "revision-b"
        ? [{source: "console" as const, type: "error", level: "error" as const, text: "new", timestamp: 2}]
        : []),
    ]
    const controller = createController(chrome)
    const opened = await controller.openPackage(openInput(chrome))
    const navigations = chrome.navigations
    if (newError) {
      await expect(controller.applyRevision!(opened.view.viewId, "revision-b")).rejects.toThrow("new revision reported console errors")
      expect(chrome.identityRevision).toBe("revision-a")
    } else {
      expect(await controller.applyRevision!(opened.view.viewId, "revision-b")).toMatchObject({revision: "revision-b", consoleErrors: []})
    }
    expect(chrome.navigations).toBe(navigations)
  })

  test.each([false, true])("применение проверяет сохранение страницы, reload=%s", async reload => {
    const chrome = new FakeChrome()
    const original = chrome.callBridge.bind(chrome)
    let origin = 42
    let applied = 0
    chrome.callBridge = async (targetId, method, params, signal) => {
      if (method === "applyRevision") {
        expect(params).toMatchObject({expectedPackageId: "@fixture/a", revision: "revision-b"})
        applied += 1
        chrome.identityRevision = "revision-b"
        if (reload) origin += 1
        const identity = await original(targetId, "identity", {}, signal) as object
        return {...identity, timeOrigin: origin, capabilities: {inPageUpdates: true}}
      }
      const result = await original(targetId, method, params, signal)
      return method === "identity" ? {...result as object, timeOrigin: origin, capabilities: {inPageUpdates: true}} : result
    }
    const controller = createController(chrome)
    const opened = await controller.openPackage(openInput(chrome))
    const url = chrome.targetsValue[0]!.url
    const navigations = chrome.navigations
    if (reload) await expect(controller.applyRevision!(opened.view.viewId, "revision-b")).rejects.toThrow("replaced its realm")
    else expect(await controller.applyRevision!(opened.view.viewId, "revision-b")).toMatchObject({revision: "revision-b", timeOrigin: 42})
    expect(applied).toBe(1)
    expect(chrome.navigations).toBe(navigations)
    expect(chrome.targetsValue[0]!.url).toBe(url)
    expect(chrome.created).toBe(1)
  })

  test.each([false, true])("applyRevision сохраняет handle и адрес при повторном обновлении, preview=%s", async preview => {
    const chrome = new FakeChrome()
    enableRevisionUpdates(chrome)
    const root = temporaryRoot()
    const controller = createController(chrome, root)
    const url = `${openInput(chrome).url}?view=contract&variant=Круг&inspector=chat${preview ? "&preview=revision-a" : ""}`
    const opened = await controller.openPackage({...openInput(chrome), url})
    for (const revision of ["revision-b", "revision-c"]) {
      expect(await controller.applyRevision!(opened.view.viewId, revision)).toMatchObject({revision, viewId: opened.view.viewId, inPageApplied: true})
      const expected = new URL(url)
      if (preview) expected.searchParams.set("preview", revision)
      expect(chrome.targetsValue[0]!.url).toBe(expected.href)
      expect(new StorybookBrowserState(join(root, "state")).readWorkspace()?.url).toBe(expected.href)
      expect(await controller.inspect(opened.view.viewId, {})).toMatchObject({view: opened.view})
      expect(await controller.inspect(opened.view.viewId, {})).toMatchObject({view: opened.view})
      expect(await controller.capture({viewId: opened.view.viewId, area: "page"})).toMatchObject({revision, route: opened.view.route})
    }
    expect(chrome.created).toBe(1)
    expect(chrome.navigations).toBe(0)
  })

  test.each(["preview", "preview-removed", "preview-added", "view", "variant", "inspector", "origin", "path", "package", "route", "realm", "result", "target", "unknown-query"])(
    "applyRevision отклоняет неожиданный переход %s", async change => {
      const chrome = new FakeChrome()
      let applied = false
      enableRevisionUpdates(chrome, () => {
        applied = true
        chrome.targetsValue = chrome.targetsValue.map(target => {
          const url = new URL(target.url)
          if (change === "preview") url.searchParams.set("preview", "revision-user")
          if (change === "preview-removed") url.searchParams.delete("preview")
          if (change === "preview-added") url.searchParams.set("preview", "revision-b")
          if (change === "view") url.searchParams.set("view", "scenarios")
          if (change === "variant") url.searchParams.set("variant", "Квадрат")
          if (change === "inspector") url.searchParams.set("inspector", "files")
          if (change === "origin") url.port = "43124"
          if (change === "path") url.pathname = "/pkg-fixture-a/fixture/a/other"
          if (change === "package") url.pathname = "/pkg-fixture-b/fixture/a/default"
          if (change === "unknown-query") url.searchParams.set("user", "changed")
          return {...target, url: url.href, ...(change === "target" ? {targetId: "REPLACED_TARGET"} : {})}
        })
      })
      const original = chrome.callBridge.bind(chrome)
      chrome.callBridge = async (target, method, params, signal) => {
        const result = await original(target, method, params, signal)
        if (!applied || method !== "identity" && method !== "applyRevision") return result
        if (change === "realm") return {...result as object, timeOrigin: 43}
        if (change === "route") return {...result as object, route: "other", markers: {...(result as {markers: object}).markers, route: "other"}}
        if (change === "result" && method === "applyRevision") return {...result as object, revision: "revision-user"}
        return result
      }
      const root = temporaryRoot()
      const controller = createController(chrome, root)
      const url = `${openInput(chrome).url}?view=contract&variant=Круг&inspector=chat${change === "preview-added" ? "" : "&preview=revision-a"}`
      const opened = await controller.openPackage({...openInput(chrome), url})
      const previousUrl = chrome.targetsValue[0]!.url
      await expect(controller.applyRevision!(opened.view.viewId, "revision-b")).rejects.toThrow()
      expect(new StorybookBrowserState(join(root, "state")).readWorkspace()?.url).toBe(previousUrl)
      expect(chrome.created).toBe(1)
      expect(chrome.navigations).toBe(0)
    },
  )

  test("переход во время проверки консоли не принимается как применение ревизии", async () => {
    const chrome = new FakeChrome()
    enableRevisionUpdates(chrome)
    let consoleReads = 0
    chrome.consoleEntries = async () => {
      if (++consoleReads === 2) chrome.targetsValue = chrome.targetsValue.map(target => ({...target, url: target.url.replace("revision-b", "revision-user")}))
      return []
    }
    const controller = createController(chrome)
    const opened = await controller.openPackage({...openInput(chrome), url: `${openInput(chrome).url}?preview=revision-a`})
    await expect(controller.applyRevision!(opened.view.viewId, "revision-b")).rejects.toThrow("navigated away")
    await expect(controller.inspect(opened.view.viewId, {})).rejects.toThrow("navigated away")
  })

  test("переход до отправки applyRevision отменяет применение", async () => {
    const chrome = new FakeChrome()
    let applications = 0
    enableRevisionUpdates(chrome, () => {applications++})
    chrome.consoleEntries = async () => {
      chrome.targetsValue = chrome.targetsValue.map(target => ({...target, url: target.url.replace("revision-a", "revision-user")}))
      return []
    }
    const controller = createController(chrome)
    const opened = await controller.openPackage({...openInput(chrome), url: `${openInput(chrome).url}?preview=revision-a`})
    await expect(controller.applyRevision!(opened.view.viewId, "revision-b")).rejects.toThrow("navigated away")
    expect(applications).toBe(0)
  })

  test("console rollback preview восстанавливает согласованные URL, запись и handle", async () => {
    const chrome = new FakeChrome()
    enableRevisionUpdates(chrome)
    chrome.consoleEntries = async () => chrome.identityRevision === "revision-b"
      ? [{source: "console", type: "error", level: "error", text: "new", timestamp: 2}] : []
    const root = temporaryRoot()
    const controller = createController(chrome, root)
    const url = `${openInput(chrome).url}?view=contract&inspector=chat&preview=revision-a`
    const opened = await controller.openPackage({...openInput(chrome), url})
    await expect(controller.applyRevision!(opened.view.viewId, "revision-b")).rejects.toThrow("previous revision retained")
    expect(chrome.identityRevision).toBe("revision-a")
    expect(chrome.targetsValue[0]!.url).toBe(url)
    expect(new StorybookBrowserState(join(root, "state")).readWorkspace()?.url).toBe(url)
    expect(await controller.inspect(opened.view.viewId, {})).toMatchObject({view: opened.view})
    expect(await controller.capture({viewId: opened.view.viewId, area: "page"})).toMatchObject({revision: "revision-a"})
  })

  test("старая страница не обновляется скрытой навигацией", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage(openInput(chrome))
    const navigations = chrome.navigations
    await expect(controller.applyRevision!(opened.view.viewId, "revision-b")).rejects.toThrow("page restart is required")
    expect(chrome.identityRevision).toBe("revision-a")
    expect(chrome.navigations).toBe(navigations)
  })

  test("unknown reservation переиспользует baseline peer, не превращая его в receipt", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const state = new StorybookBrowserState(join(root, "state"))
    const expectedUrl = `${chrome.origin}/pkg-fixture-a/original?preview=old`
    state.reserveWorkspace({packageId: "@fixture/a", cdpOrigin: chrome.cdp, browserIdentity: await chrome.browserIdentity(),
      url: expectedUrl, baselineTargetIds: ["BASELINE", "FOREIGN"]})
    state.markCreateSent()
    const stateFile = join(root, "state", readdirSync(join(root, "state")).find(name => name === "workspace.json")!)
    const bytes = readFileSync(stateFile, "utf8")
    const foreign = {targetId: "FOREIGN", type: "page", title: "B", url: `${chrome.origin}/pkg-fixture-b/`}
    chrome.targetsValue = [{targetId: "BASELINE", type: "page", title: "A", url: `${chrome.origin}/pkg-fixture-a/`}, foreign]
    chrome.hangingTargetIds.add("FOREIGN")
    chrome.focusedTarget = "BASELINE"
    chrome.revisionAfterNavigate = "revision-next"
    const controller = createController(chrome, root)
    const input = {...openInput(chrome), expectedRevision: "revision-next"}
    const opened = await controller.openPackage(input)
    expect(opened.reused).toBeTrue()
    expect(opened.identity).toMatchObject({ready: true, revision: "revision-next", route: input.route})
    expect(chrome.navigatedTargets).toEqual([])
    expect(chrome.bridgeNavigations).toBe(1)
    expect(chrome.targetsValue.find(target => target.targetId === "FOREIGN")).toEqual(foreign)
    expect(readFileSync(stateFile, "utf8")).toBe(bytes)
    expect((await createController(chrome, root).openPackage(input)).view.viewId).toBe(opened.view.viewId)
    expect(readFileSync(stateFile, "utf8")).toBe(bytes)
    expect(chrome.created).toBe(0)
    expect(chrome.closed).toEqual([])
    chrome.targetsValue.push({targetId: "LATE_RECEIPT", type: "page", title: "A", url: expectedUrl})
    await controller.openPackage(input)
    expect(state.readWorkspace()).toMatchObject({phase: "owned", targetId: "LATE_RECEIPT"})
    expect(chrome.created).toBe(0)
    expect(chrome.closed).toEqual([])
  })

  test.each(["wrong-package", "unverified", "revision", "readiness"])("unknown peer recovery сохраняет guards и запись при отказе: %s", async failure => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const state = new StorybookBrowserState(join(root, "state"))
    state.reserveWorkspace({packageId: "@fixture/a", cdpOrigin: chrome.cdp, browserIdentity: await chrome.browserIdentity(),
      url: `${chrome.origin}/pkg-fixture-a/original`, baselineTargetIds: ["BASELINE"]})
    state.markCreateSent()
    const before = state.readWorkspace()
    chrome.targetsValue = [{targetId: "BASELINE", type: "page", title: "A", url: openInput(chrome).url}]
    if (failure === "wrong-package") chrome.identityPackageOverrides.set("BASELINE", "@fixture/b")
    if (failure === "unverified") chrome.foreignTargetIds.add("BASELINE")
    if (failure === "readiness") chrome.waitReady = async () => {throw new Error("Page readiness failed")}
    if (failure === "revision") {
      const bridge = chrome.callBridge.bind(chrome)
      chrome.callBridge = async (target, method, params, signal) => {
        const result = await bridge(target, method, params, signal)
        if (method === "navigate") chrome.identityRevision = "revision-a"
        return result
      }
    }
    const error = failure === "revision" ? "revision mismatch" : failure === "readiness" ? "readiness failed" : "creation is indeterminate"
    await expect(createController(chrome, root).openPackage({...openInput(chrome), expectedRevision: "revision-next"})).rejects.toThrow(error)
    expect(state.readWorkspace()).toEqual(before)
    expect(chrome.created).toBe(0)
    expect(chrome.closed).toEqual([])
    if (failure === "wrong-package" || failure === "unverified") expect(chrome.navigations).toBe(0)
  })

  test.each(["verified", "not-ready", "bootstrap-owned", "indeterminate", "missing"])("indeterminate evidence различает наблюдение target и отсутствие receipt: %s", async outcome => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const state = new StorybookBrowserState(join(root, "state"))
    state.reserveWorkspace({
      packageId: "@fixture/a", cdpOrigin: chrome.cdp, browserIdentity: await chrome.browserIdentity(),
      url: `${chrome.origin}/pkg-fixture-a/expected?preview=SECRET_QUERY`, baselineTargetIds: [],
    })
    state.markCreateSent()
    const before = state.readWorkspace()
    if (outcome !== "missing") chrome.targetsValue = [{
      targetId: "PRIVATE_BASELINE", type: "page", title: "A", url: `${chrome.origin}/pkg-fixture-a/observed?preview=ANOTHER_SECRET`,
    }]
    if (outcome === "not-ready") chrome.identityReady = false
    if (outcome === "bootstrap-owned") chrome.markerOnlyTargetIds.add("PRIVATE_BASELINE")
    if (outcome === "indeterminate") chrome.unavailableDiagnosticsTargetIds.add("PRIVATE_BASELINE")
    const controller = createController(chrome, root)
    let message = ""
    try { await controller.openPackage(openInput(chrome)) } catch (error) {message = (error as Error).message}
    expect(message).toContain("creation is indeterminate")
    const evidence = JSON.parse(message.split("; evidence=")[1]!)
    expect(evidence.reservation).toMatchObject({
      protocol: "external-storybook-browser-workspace/1", phase: "reserved", createSent: true,
      recordedReceipt: false, sendHistoryAvailable: false, expectedPath: "/pkg-fixture-a/expected",
    })
    expect(evidence.observation).toMatchObject({inventoryCompleted: true, sameBrowserSession: true, exactNewReservationUrlCount: 0})
    if (outcome === "missing") expect(evidence.observation.targets).toEqual([])
    else expect(evidence.observation.targets[0]).toMatchObject({
      path: "/pkg-fixture-a/observed", inBaseline: false, sameReservationUrl: false, attestation: outcome,
    })
    for (const secret of ["SECRET_QUERY", "ANOTHER_SECRET", "PRIVATE_BASELINE", chrome.origin, chrome.cdp]) {
      expect(message).not.toContain(secret)
    }
    expect(state.readWorkspace()).toEqual(before)
    expect(chrome.created).toBe(0)
    expect(chrome.navigations).toBe(0)
    expect(chrome.closed).toEqual([])
  })

  test("reservation evidence ограничивает read-only attestation тремя matching targets", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const state = new StorybookBrowserState(join(root, "state"))
    state.reserveWorkspace({packageId: "@fixture/a", cdpOrigin: chrome.cdp, browserIdentity: await chrome.browserIdentity(),
      url: `${chrome.origin}/pkg-fixture-a/expected`, baselineTargetIds: []})
    state.markCreateSent()
    chrome.targetsValue = Array.from({length: 5}, (_, index) => ({
      targetId: `PRIVATE_${index}`, type: "page", title: "A", url: `${chrome.origin}/pkg-fixture-a/observed-${index}`,
    }))
    chrome.targetsValue.push({targetId: "FOREIGN", type: "page", title: "B", url: `${chrome.origin}/pkg-fixture-b/`})
    chrome.hangingTargetIds.add("FOREIGN")
    let message = ""
    try {await createController(chrome, root).openPackage(openInput(chrome))} catch (error) {message = (error as Error).message}
    const evidence = JSON.parse(message.split("; evidence=")[1]!)
    expect(evidence.observation).toMatchObject({matchingWorkspaceCount: 6, omittedCount: 3})
    expect(evidence.observation.targets).toHaveLength(3)
    expect(chrome.identityCalls).toBe(3)
    expect(chrome.created).toBe(0)
  })

  test.each(["failure", "abort"])("сбой до create send освобождает reservation и допускает один retry: %s", async reason => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const controller = createController(chrome, root)
    const state = new StorybookBrowserState(join(root, "state"))
    const abort = new AbortController()
    chrome.createPreflight = () => {
      if (reason === "abort") abort.abort(new DOMException("До отправки", "AbortError"))
      else throw new Error("Ошибка preflight")
    }
    await expect(controller.openPackage(openInput(chrome), abort.signal)).rejects.toThrow()
    expect(chrome.created).toBe(0)
    expect(state.readWorkspace()).toBeNull()
    chrome.createPreflight = null
    const opened = await createController(chrome, root).openPackage(openInput(chrome))
    expect(opened.identity.ready).toBeTrue()
    expect(chrome.created).toBe(1)
    expect(chrome.closed).toEqual([])
  })

  test("клиент без dispatch-контракта сохраняет неопределённую reservation при ошибке", async () => {
    const chrome = new FakeChrome()
    Object.defineProperty(chrome, "createTargetWithDispatch", {value: undefined})
    chrome.createPreflight = () => {throw new Error("Неизвестна граница отправки")}
    const root = temporaryRoot()
    const controller = createController(chrome, root)
    await expect(controller.openPackage(openInput(chrome))).rejects.toThrow("Неизвестна граница")
    chrome.createPreflight = null
    await expect(controller.openPackage(openInput(chrome))).rejects.toThrow("creation is indeterminate")
    expect(chrome.created).toBe(0)
    expect(new StorybookBrowserState(join(root, "state")).readWorkspace())
      .toMatchObject({phase: "reserved", createSent: true})
  })

  test("reuses one package view and never returns the CDP target identity", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const input = {
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`,
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

  test("warm open сохраняет inspector без повторной навигации документа", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const input = openInput(chrome)
    const first = await controller.openPackage({...input, url: `${input.url}?inspector=output`})
    const before = chrome.navigations
    const second = await controller.openPackage(input)
    expect(second.view.viewId).toBe(first.view.viewId)
    expect(chrome.navigations).toBe(before)
    expect(chrome.targetsValue[0]?.url).toContain("inspector=output")
  })

  test("adopts an attested package target from the previous server origin", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.targetsValue = [{
      targetId: "OLD_TARGET",
      type: "page",
      title: "Old Storybook",
      url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default",
    }]
    new StorybookBrowserState(join(root, "state")).writeWorkspace({
      packageId: "@fixture/a", cdpOrigin: chrome.cdp, browserIdentity: await chrome.browserIdentity(), targetId: "OLD_TARGET",
    })
    const opened = await createController(chrome, root).openPackage(openInput(chrome))

    expect(opened.reused).toBeTrue()
    expect(chrome.created).toBe(0)
    expect(chrome.navigations).toBe(1)
    expect(chrome.targetsValue).toEqual([expect.objectContaining({
      targetId: "OLD_TARGET",
      url: openInput(chrome).url,
    })])
  })

  test("reuses a matching package tab without closing peers or stealing focus", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "A", url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`},
      {targetId: "OLD_B", type: "page", title: "B", url: "http://127.0.0.1:42000/pkg-fixture-a/fixture/a/default"},
    ]
    const opened = await createController(chrome).openPackage(openInput(chrome))
    expect(opened.reused).toBeTrue()
    expect(chrome.closed).toEqual([])
    expect(chrome.activated).toEqual([])
    expect(chrome.targetsValue).toHaveLength(2)
  })

  test("новый server state не присваивает вкладку другого origin в общем Chrome", async () => {
    const chrome = new FakeChrome()
    const peer = {targetId: "PEER_SERVER", type: "page", title: "A", url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default"}
    chrome.targetsValue = [peer]
    const opened = await createController(chrome).openPackage(openInput(chrome))
    expect(opened.reused).toBeFalse()
    expect(chrome.created).toBe(1)
    expect(chrome.targetsValue).toContainEqual(peer)
    expect(chrome.navigations).toBe(0)
    expect(chrome.closed).toEqual([])
  })

  test("просмотр вкладок не вызывает запуск или health с запуском браузера", async () => {
    const chrome = new FakeChrome()
    chrome.ensure = async () => { throw new Error("inventory cannot launch Chrome") }
    chrome.health = async () => { throw new Error("inventory cannot bootstrap Chrome") }
    expect(await createController(chrome).listViews(chrome.origin)).toEqual([])
    expect(chrome.created).toBe(0)
  })

  test("prefers the agent's existing matching view without changing its peers", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.targetsValue = [
      {targetId: "USER", type: "page", title: "User", url: openInput(chrome).url},
      {targetId: "AGENT", type: "page", title: "Agent", url: `${chrome.origin}/pkg-fixture-a/fixture/a/alternate`},
    ]
    new StorybookBrowserState(join(root, "state")).writeWorkspace({packageId: "@fixture/a", cdpOrigin: chrome.cdp, browserIdentity: "a".repeat(64), targetId: "AGENT"})
    const views = await createController(chrome, root).listViews(chrome.origin)
    expect(views[0]?.route).toBe("fixture/a/alternate")
    expect(chrome.navigations).toBe(0)
    expect(chrome.activated).toEqual([])
    expect(chrome.closed).toEqual([])
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
      .rejects.toMatchObject({name: "TimeoutError", message: expect.stringContaining('"readyState":"complete"')})

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

  test.each([false, true])("явное восстановление сохраняет появившуюся вкладку: %s", async appeared => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.deferCreatedTarget = true
    chrome.throwAfterCreate = true
    await expect(createController(chrome, root).openPackage(openInput(chrome)))
      .rejects.toThrow("simulated owner crash")
    chrome.throwAfterCreate = false
    chrome.deferCreatedTarget = false
    if (appeared) chrome.materializeCreatedTarget()

    const opened = await createController(chrome, root).openPackage({...openInput(chrome), recover: true})
    expect(opened.reused).toBe(appeared)
    expect(chrome.created).toBe(appeared ? 1 : 2)
    expect(chrome.closed).toEqual([])
  })

  test("восстановление не сбрасывает запись при неподтверждённой вкладке пакета", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.deferCreatedTarget = true
    chrome.throwAfterCreate = true
    await expect(createController(chrome, root).openPackage(openInput(chrome)))
      .rejects.toThrow("simulated owner crash")
    chrome.throwAfterCreate = false
    chrome.targetsValue.push({targetId: "UNKNOWN", type: "page", title: "Unknown", url: openInput(chrome).url + "?other=1"})
    await expect(createController(chrome, root).openPackage({...openInput(chrome), recover: true}))
      .rejects.toThrow("target creation is indeterminate")
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
      url: "http://127.0.0.1:44123/pkg-fixture-a/fixture/a/alternate",
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

  test("preserves a recorded tab that no longer shows the package", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    new StorybookBrowserState(join(root, "state")).writeWorkspace({
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

    expect(opened.reused).toBeFalse()
    expect(chrome.created).toBe(1)
    expect(chrome.navigations).toBe(0)
    expect(chrome.targetsValue.find(target => target.targetId === chrome.targetId)?.url).toBe("about:blank")
  })

  test("reattests a duplicate immediately before close and preserves a tab navigated away by the user", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "A", url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default"},
      {targetId: "OLD_B", type: "page", title: "B", url: "http://127.0.0.1:42000/pkg-fixture-a/fixture/a/default"},
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
      url: `${chrome.origin}/pkg-fixture-a/fixture/a/alternate`,
    })

    expect(second.reused).toBeTrue()
    expect(second.view.viewId).not.toBe(first.view.viewId)
    expect(() => controller.getView(first.view.viewId)).toThrow("Unknown")
    expect(second.view.route).toBe("fixture/a/alternate")
    expect(chrome.created).toBe(1)
  })

  test("lists current views without normalizing or closing other tabs", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Old", url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`},
    ]
    const views = await createController(chrome).listViews(chrome.origin)

    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({packageId: "@fixture/a"})
    expect(chrome.closed).toEqual([])
  })

  test("ignores a foreign-origin peer that cannot be attested", async () => {
    const chrome = new FakeChrome()
    chrome.foreignTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Old", url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`},
    ]

    const views = await createController(chrome).listViews(chrome.origin)
    expect(views).toHaveLength(1)
    expect(chrome.closed).toEqual([])
  })

  test("preserves a named legacy peer without modern package markers", async () => {
    const chrome = new FakeChrome()
    chrome.legacyTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Old", url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`},
    ]

    const views = await createController(chrome).listViews(chrome.origin)
    expect(views).toHaveLength(1)
    expect(chrome.closed).toEqual([])
  })

  test("preserves a marker-owned legacy peer without window name", async () => {
    const chrome = new FakeChrome()
    chrome.markerOnlyTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Old", url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`},
    ]

    const views = await createController(chrome).listViews(chrome.origin)
    expect(views).toHaveLength(1)
    expect(chrome.closed).toEqual([])
  })

  test("preserves a legacy error document", async () => {
    const chrome = new FakeChrome()
    chrome.titleOnlyTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Fixture A", url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`},
    ]

    const views = await createController(chrome).listViews(chrome.origin, undefined, [{
      packageId: "@fixture/a",
      label: "Fixture A",
    }])
    expect(views).toHaveLength(1)
    expect(chrome.closed).toEqual([])
  })

  test("preserves a target whose diagnostics are unavailable", async () => {
    const chrome = new FakeChrome()
    chrome.unavailableDiagnosticsTargetIds.add("OLD_A")
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "Fixture A", url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default"},
      {targetId: "CURRENT_A", type: "page", title: "Current", url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`},
    ]

    const views = await createController(chrome).listViews(chrome.origin, undefined, [{
      packageId: "@fixture/a",
      label: "Fixture A",
    }])
    expect(views).toHaveLength(1)
    expect(chrome.closed).toEqual([])
  })

  test("does not let another package's legacy duplicates block an exact open", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "B1", type: "page", title: "B1", url: "http://127.0.0.1:41000/pkg-fixture-b/"},
      {targetId: "B2", type: "page", title: "B2", url: "http://127.0.0.1:42000/pkg-fixture-b/"},
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
      url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`,
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
      url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`,
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
      url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`,
    })).rejects.toThrow("window.name")
    expect(chrome.activated).toEqual([])
  })

  test("explicit recover reloads one recorded stalled target after independent marker attestation", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage(openInput(chrome))
    const originalDiagnostic = chrome.bridgeDiagnostics.bind(chrome)
    chrome.bridgeDiagnostics = async (target, signal) => {
      await originalDiagnostic(target, signal)
      return {viewName: "storybook:workspace", markers: {packageId: "@fixture/a"}}
    }
    const originalNavigate = chrome.navigate.bind(chrome)
    chrome.navigate = async (target, url) => {chrome.hangBridgeMethod = null; await originalNavigate(target, url)}
    chrome.hangBridgeMethod = "identity"
    const recovered = await controller.openPackage({...openInput(chrome), recover: true, timeoutMs: 1200})
    expect(recovered.view.viewId).toBe(opened.view.viewId)
    expect(recovered.view.route).toBe(opened.view.route)
    expect(recovered.reused).toBe(true)
    expect(chrome.created).toBe(1)
    expect(chrome.navigations).toBe(1)
    expect(chrome.closed).toEqual([])
    expect(chrome.navigatedTargets).toEqual([chrome.targetsValue[0]!.targetId])
  })

  test("recover rebinds only server-selected preview pin and preserves same route view and Inspector", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const original = {...openInput(chrome), url: `${openInput(chrome).url}?view=contract&inspector=chat&preview=revision-old`}
    const opened = await controller.openPackage(original)
    chrome.hangBridgeMethod = "identity"
    chrome.bridgeDiagnostics = async () => ({viewName: "storybook:workspace", markers: {packageId: "@fixture/a"}})
    const navigate = chrome.navigate.bind(chrome)
    chrome.navigate = async (target, url) => {chrome.hangBridgeMethod = null; await navigate(target, url)}
    chrome.revisionAfterNavigate = "revision-next"
    const recovered = await controller.openPackage({...original, url: `${openInput(chrome).url}?view=contract&preview=revision-next`,
      expectedRevision: "revision-next", recover: true, timeoutMs: 1200})
    expect(recovered.view.viewId).toBe(opened.view.viewId)
    expect(recovered.identity.revision).toBe("revision-next")
    expect(chrome.targetsValue[0]!.url).toBe(`${openInput(chrome).url}?view=contract&preview=revision-next&inspector=chat`)
    expect(chrome.navigations).toBe(1)
    expect(chrome.created).toBe(1)
  })

  test.each(["fetch", "console"])("recover installs the server-selected revision in the same healthy owned tab after failed in-page delivery: %s", async failure => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const original = {...openInput(chrome), url: `${openInput(chrome).url}?view=contract&inspector=chat`}
    const identity = chrome.callBridge.bind(chrome)
    chrome.callBridge = async (target, method, params, signal) => {
      if (method === "applyRevision") {
        if (failure === "fetch") throw new TypeError("Failed to fetch")
        chrome.identityRevision = (params as {revision: string}).revision
        return {...await identity(target, "identity", params, signal) as object, capabilities: {inPageUpdates: true}}
      }
      const result = await identity(target, method, params, signal)
      return method === "identity" ? {...result as object, capabilities: {inPageUpdates: true}} : result
    }
    chrome.consoleEntries = async () => failure === "console" && chrome.identityRevision === "revision-next"
      ? [{source: "log", type: "network", level: "error", text: "Package reader renewal returned 400", timestamp: 2}]
      : []
    const opened = await controller.openPackage(original)
    await expect(controller.applyRevision!(opened.view.viewId, "revision-next"),
      "Ошибка доставки новой ревизии сохраняет прежнее исполнение").rejects.toThrow(
      failure === "fetch" ? "Failed to fetch" : "new revision reported console errors",
    )
    expect(chrome.identityRevision, "Ошибка применения сохраняет последнюю рабочую ревизию").toBe("revision-a")
    expect(chrome.navigations, "Неудача HMR не вызывает скрытую загрузку страницы").toBe(0)
    chrome.revisionAfterNavigate = "revision-next"
    const recovered = await controller.openPackage({...original,
      url: `${openInput(chrome).url}?view=contract&preview=revision-next`,
      expectedRevision: "revision-next", recover: true})
    expect(recovered.view, "Восстановление сохраняет handle и маршрут подтверждённой вкладки").toEqual(opened.view)
    expect(recovered.identity.revision, "Browser принимает точную выбранную сервером ревизию").toBe("revision-next")
    expect(recovered.reused, "Восстановление использует прежнюю вкладку").toBe(true)
    expect(chrome.navigatedTargets, "Загружается ровно один прежний target").toEqual([chrome.targetId])
    expect(chrome.targetsValue[0]!.url, "Маршрут и Inspector сохраняются при смене preview pin").toBe(
      `${openInput(chrome).url}?view=contract&preview=revision-next&inspector=chat`,
    )
    expect(chrome.created, "Восстановление не создаёт дубль вкладки").toBe(1)
    expect(chrome.closed, "Соседние вкладки остаются открытыми").toEqual([])
  })

  test("recover preserves healthy owned target and default open does not reload a stalled bridge", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    await controller.openPackage(openInput(chrome))
    await controller.openPackage({...openInput(chrome), recover: true, timeoutMs: 1200})
    expect(chrome.navigations).toBe(0)
    chrome.hangBridgeMethod = "identity"
    await expect(controller.openPackage({...openInput(chrome), timeoutMs: 100})).rejects.toMatchObject({name: "TimeoutError"})
    expect(chrome.navigations).toBe(0)
    expect(chrome.created).toBe(1)
  })

  test.each(["different-marker", "different-route", "different-origin"])("recover refuses unsafe native evidence %s without navigation or duplicate target", async evidence => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    await controller.openPackage(openInput(chrome))
    chrome.hangBridgeMethod = "identity"
    chrome.bridgeDiagnostics = async () => ({viewName: "storybook:workspace", markers: {packageId: evidence === "different-marker" ? "@fixture/b" : "@fixture/a"}})
    if (evidence === "different-origin") chrome.targetsValue = chrome.targetsValue.map(target => ({...target, url: target.url.replace(chrome.origin, "http://127.0.0.1:54322")}))
    const input = evidence === "different-route" ? {...openInput(chrome), route: "fixture/a/other", url: `${chrome.origin}/pkg-fixture-a/fixture/a/other`} : openInput(chrome)
    await expect(controller.openPackage({...input, recover: true, timeoutMs: 600})).rejects.toThrow("recovery")
    expect(chrome.navigations).toBe(0)
    expect(chrome.created).toBe(1)
    expect(chrome.closed).toEqual([])
  })

  test("recover rechecks exact native target origin before navigation", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    await controller.openPackage(openInput(chrome))
    chrome.hangBridgeMethod = "identity"
    chrome.bridgeDiagnostics = async () => {
      chrome.targetsValue = chrome.targetsValue.map(target => ({...target, url: "https://example.com/user-page"}))
      return {viewName: "storybook:workspace", markers: {packageId: "@fixture/a"}}
    }
    await expect(controller.openPackage({...openInput(chrome), recover: true, timeoutMs: 600})).rejects.toThrow("recovery target changed")
    expect(chrome.navigations).toBe(0)
    expect(chrome.created).toBe(1)
    expect(chrome.closed).toEqual([])
  })

  test("waits for the package bridge after document readiness", async () => {
    const chrome = new FakeChrome()
    chrome.unavailableBridgeCalls = 2
    const controller = createController(chrome)
    const opened = await controller.openPackage({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`,
      timeoutMs: 1_000,
    })
    expect(opened.identity.ready).toBeTrue()
    expect(chrome.identityCalls).toBeGreaterThanOrEqual(3)
  })

  test("bounds the whole open and interaction operations by their public timeout", async () => {
    const hangingHealth = new FakeChrome()
    hangingHealth.hangHealth = true
    const healthController = createController(hangingHealth)
    await expect(healthController.openPackage({
      origin: hangingHealth.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${hangingHealth.origin}/pkg-fixture-a/fixture/a/default`,
      timeoutMs: 100,
    })).rejects.toMatchObject({name: "TimeoutError", message: expect.stringContaining("Chrome connection")})

    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`,
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
  readonly identityPackageOverrides = new Map<string, string>()
  readonly legacyTargetIds = new Set<string>()
  readonly markerOnlyTargetIds = new Set<string>()
  readonly titleOnlyTargetIds = new Set<string>()
  readonly unavailableDiagnosticsTargetIds = new Set<string>()
  readonly hangingTargetIds = new Set<string>()
  readonly closed: string[] = []
  readonly activated: string[] = []
  readonly targetOperations: string[] = []
  created = 0
  lastClip: unknown
  invalidIdentity = false
  unavailableBridgeCalls = 0
  transitioningBridgeCalls = 0
  identityCalls = 0
  identityRevision = "revision-a"
  identityReady = true
  inPageNavigation = true
  followEnvironment = false
  focusedTarget: string | null = null
  bridgeNavigations = 0
  revisionAfterNavigate: string | null = null
  navigations = 0
  readonly navigatedTargets: string[] = []
  hangHealth = false
  hangBridgeMethod: StorybookBridgeMethod | null = null
  foreignizeOnWaitReady: string | null = null
  throwAfterCreate = false
  deferCreatedTarget = false
  pendingTarget: ChromeTargetSummary | null = null
  createPreflight: (() => void) | null = null

  async health(signal?: AbortSignal): Promise<void> {
    if (this.hangHealth) await hangUntilAbort(signal)
  }
  async ensure(signal?: AbortSignal): Promise<void> {
    await this.health(signal)
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
  async createTargetWithDispatch(url: string, beforeSend: () => void, signal?: AbortSignal): Promise<ChromeTargetSummary> {
    return this.createTarget(url, signal, beforeSend)
  }
  async createTarget(url: string, signal?: AbortSignal, beforeSend?: () => void): Promise<ChromeTargetSummary> {
    this.createPreflight?.()
    signal?.throwIfAborted()
    beforeSend?.()
    this.created += 1
    const target = {
      targetId: this.created === 1 && !this.targetsValue.some(target => target.targetId === this.targetId) ? this.targetId : `${this.targetId}_${this.created}`,
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
  async navigate(targetId: string, url: string): Promise<void> {
    this.navigations += 1
    this.navigatedTargets.push(targetId)
    if (this.revisionAfterNavigate !== null) this.identityRevision = this.revisionAfterNavigate
    this.targetsValue = this.targetsValue.map((target) => target.targetId === targetId ? {...target, url} : target)
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
  async consoleEntries(): Promise<readonly StorybookChromeConsoleEntry[]> {
    return []
  }
  async bridgeDiagnostics(targetId: string, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    signal?.throwIfAborted()
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
    params?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    signal?.throwIfAborted()
    if (this.hangingTargetIds.has(targetId)) await hangUntilAbort(signal)
    if (this.hangBridgeMethod === method) await hangUntilAbort(signal)
    if (this.foreignTargetIds.has(targetId)) {
      throw new Error("Storybook agent bridge is unavailable in the exact target")
    }
    if (this.legacyTargetIds.has(targetId) || this.markerOnlyTargetIds.has(targetId) ||
      this.titleOnlyTargetIds.has(targetId) || this.unavailableDiagnosticsTargetIds.has(targetId)) {
      throw new Error("Storybook agent bridge is unavailable in the exact target")
    }
    if (method === "navigate") {
      const input = params as {expectedPackageId: string | null; packageId: string | null; url: string; revision?: string; followEnvironment?: true}
      const current = this.targetsValue.find(target => target.targetId === targetId)!
      if (targetIdentity(current.url).packageId !== input.expectedPackageId) throw new Error("Storybook bridge address changed")
      if (input.followEnvironment && !this.followEnvironment) throw new Error("Storybook environment following was disabled")
      this.bridgeNavigations += 1
      this.targetsValue = this.targetsValue.map(target => target.targetId === targetId
        ? {...target, url: new URL(input.url, this.origin).href} : target)
      this.identityPackageOverrides.delete(targetId)
      if (input.revision !== undefined) this.identityRevision = input.revision
      return this.callBridge(targetId, "identity", {}, signal)
    }
    if (method === "identity") {
      this.identityCalls += 1
      this.targetOperations.push(`identity:${targetId}`)
      if (this.identityCalls <= this.transitioningBridgeCalls) {
        const error = new Error("Storybook page is transitioning")
        error.name = "StorybookCdpTargetTransition"
        throw error
      }
      if (this.identityCalls <= this.unavailableBridgeCalls) {
        throw new Error("Storybook agent bridge is unavailable in the exact target")
      }
      const current = this.targetsValue.find(({targetId: candidate}) => candidate === targetId)
      const decoded = current === undefined
        ? {packageId: "@fixture/a", route: "fixture/a/default"}
        : targetIdentity(current.url)
      const target = {...decoded, packageId: this.identityPackageOverrides.get(targetId) ?? decoded.packageId}
      return {
      protocol: "external-storybook-agent-bridge/1",
      packageId: target.packageId,
      route: target.route,
      revision: target.packageId === null ? null : this.identityRevision,
      graphDigest: "a".repeat(64),
      ready: this.identityReady,
      presented: true,
      timeOrigin: 42,
      viewName: this.invalidIdentity ? "storybook:foreign" : this.inPageNavigation || target.packageId === null ? "storybook:workspace" : `storybook:${target.packageId}`,
      capabilities: {inPageNavigation: this.inPageNavigation},
      followEnvironment: this.followEnvironment,
      nativePage: {hasFocus: this.focusedTarget === targetId, visibilityState: this.focusedTarget === targetId ? "visible" : "hidden"},
      markers: {
        package: "ready",
        packageId: target.packageId,
        route: target.route,
        revision: target.packageId === null ? null : this.identityRevision,
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

function enableRevisionUpdates(chrome: FakeChrome, afterApply: (revision: string) => void = () => {}): void {
  const original = chrome.callBridge.bind(chrome)
  chrome.callBridge = async (target, method, params, signal) => {
    if (method === "applyRevision") {
      const revision = (params as {revision: string}).revision
      chrome.identityRevision = revision
      chrome.targetsValue = chrome.targetsValue.map(current => {
        const url = new URL(current.url)
        if (url.searchParams.has("preview")) url.searchParams.set("preview", revision)
        return {...current, url: url.href}
      })
      afterApply(revision)
    }
    const result = await original(target, method === "applyRevision" ? "identity" : method, params, signal)
    return method === "identity" || method === "applyRevision"
      ? {...result as object, capabilities: {inPageNavigation: true, inPageUpdates: true}} : result
  }
}

function targetIdentity(value: string): Readonly<{packageId: string | null; route: string}> {
  const url = new URL(value)
  if (url.pathname === "/") return {packageId: null, route: ""}
  const parts = url.pathname.split("/")
  const fallback = decodeURIComponent(parts[parts[1] === "packages" ? 2 : 1]!)
  const packageId = ["@fixture/a", "@fixture/b", "@fixture/other", "a", "b"]
    .find(id => storybookPackageRouteFromPathname(url.pathname, id) !== null) ?? fallback
  return Object.freeze({packageId, route: storybookPackageRouteFromPathname(url.pathname, packageId) ?? ""})
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
    url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`,
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

test("диагностика занятой страницы возвращает native профиль только для своей вкладки", async () => {
  const chrome = new FakeChrome()
  let samples = 0
  const diagnosticChrome = Object.assign(chrome, {async sampleExecution() {
    samples += 1
    return {samples: 3, hot: [{function: "layout"}]}
  }})
  const controller = createController(diagnosticChrome)
  const opened = await controller.openPackage(openInput(chrome))
  chrome.callBridge = async () => { throw new DOMException("bridge unresponsive", "TimeoutError") }
  expect(await controller.inspect(opened.view.viewId, {include: ["diagnostics"]})).toMatchObject({
    ready: false,
    bridgeAvailable: false,
    diagnostics: [{phase: "bridge", message: "bridge unresponsive"}],
    execution: {samples: 3, hot: [{function: "layout"}]},
  })
  chrome.targetsValue[0] = {...chrome.targetsValue[0]!, url: `${chrome.origin}/pkg-fixture-b/`}
  await expect(controller.inspect(opened.view.viewId, {include: ["diagnostics"]})).rejects.toThrow()
  expect(samples).toBe(1)
})


test("временное отсутствие CDP-контекста при открытии ждёт ту же вкладку", async () => {
  const chrome = new FakeChrome()
  chrome.transitioningBridgeCalls = 2
  const opened = await createController(chrome).openPackage(openInput(chrome))
  expect(opened.identity.ready).toBeTrue()
  expect(chrome.identityCalls).toBeGreaterThanOrEqual(3)
  expect(chrome.created).toBe(1)
  expect(chrome.navigations).toBe(0)
})

test("инвентарь возвращает только выбранное пространство и не ждёт legacy peer", async () => {
  const chrome = new FakeChrome()
  const controller = createController(chrome)
  const opened = await controller.openPackage(openInput(chrome))
  chrome.targetsValue.push({targetId: "LEGACY_B", type: "page", title: "B", url: `${chrome.origin}/pkg-fixture-b/`})
  chrome.hangingTargetIds.add("LEGACY_B")
  expect(await controller.listViews(chrome.origin, AbortSignal.timeout(200), undefined, "@fixture/a")).toEqual([opened.view])
  expect(await controller.listViews(chrome.origin, AbortSignal.timeout(200), undefined, "@fixture/b")).toEqual([])
  expect(chrome.targetOperations.every(value => !value.includes(":LEGACY_B"))).toBeTrue()
})
