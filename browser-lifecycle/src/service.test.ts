import {storybookPackageRouteFromPathname} from "./contract.ts"
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
  test.each(["verified", "not-ready", "bootstrap-owned", "indeterminate", "missing"])("indeterminate evidence различает наблюдение target и отсутствие receipt: %s", async outcome => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const state = new StorybookBrowserState(join(root, "state"))
    state.reserveTarget({
      packageId: "@fixture/a", cdpOrigin: chrome.cdp, browserIdentity: await chrome.browserIdentity(),
      url: `${chrome.origin}/pkg-fixture-a/expected?preview=SECRET_QUERY`, baselineTargetIds: ["PRIVATE_BASELINE"],
    })
    state.markCreateSent("@fixture/a")
    const before = state.readTarget("@fixture/a")
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
      protocol: "external-storybook-browser-target/3", phase: "reserved", createSent: true,
      recordedReceipt: false, sendHistoryAvailable: false, expectedPath: "/pkg-fixture-a/expected",
    })
    expect(evidence.observation).toMatchObject({inventoryCompleted: true, sameBrowserSession: true, exactNewReservationUrlCount: 0})
    if (outcome === "missing") expect(evidence.observation.targets).toEqual([])
    else expect(evidence.observation.targets[0]).toMatchObject({
      path: "/pkg-fixture-a/observed", inBaseline: true, sameReservationUrl: false, attestation: outcome,
    })
    for (const secret of ["SECRET_QUERY", "ANOTHER_SECRET", "PRIVATE_BASELINE", chrome.origin, chrome.cdp]) {
      expect(message).not.toContain(secret)
    }
    expect(state.readTarget("@fixture/a")).toEqual(before)
    expect(chrome.created).toBe(0)
    expect(chrome.navigations).toBe(0)
    expect(chrome.closed).toEqual([])
  })

  test("reservation evidence ограничивает read-only attestation тремя matching targets", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    const state = new StorybookBrowserState(join(root, "state"))
    state.reserveTarget({packageId: "@fixture/a", cdpOrigin: chrome.cdp, browserIdentity: await chrome.browserIdentity(),
      url: `${chrome.origin}/pkg-fixture-a/expected`, baselineTargetIds: []})
    state.markCreateSent("@fixture/a")
    chrome.targetsValue = Array.from({length: 5}, (_, index) => ({
      targetId: `PRIVATE_${index}`, type: "page", title: "A", url: `${chrome.origin}/pkg-fixture-a/observed-${index}`,
    }))
    chrome.targetsValue.push({targetId: "FOREIGN", type: "page", title: "B", url: `${chrome.origin}/pkg-fixture-b/`})
    chrome.hangingTargetIds.add("FOREIGN")
    let message = ""
    try {await createController(chrome, root).openPackage(openInput(chrome))} catch (error) {message = (error as Error).message}
    const evidence = JSON.parse(message.split("; evidence=")[1]!)
    expect(evidence.observation).toMatchObject({matchingPackageCount: 5, omittedCount: 2})
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
    expect(state.readTarget("@fixture/a")).toBeNull()
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
    expect(new StorybookBrowserState(join(root, "state")).readTarget("@fixture/a"))
      .toMatchObject({phase: "reserved", createSent: true})
  })

  test.each([[false, false], [false, true], [true, false], [true, true]] as const)("незавершённый inventory сохраняет handles: abort=%s, known packages=%s", async (abort, knownPackages) => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "A", type: "page", title: "A", url: `${chrome.origin}/pkg-fixture-a/`},
      {targetId: "B", type: "page", title: "B", url: `${chrome.origin}/packages/%40fixture%2Fb/`},
    ]
    const controller = createController(chrome)
    const labels = [{packageId: "@fixture/a", label: "A"}, {packageId: "@fixture/b", label: "B"}]
    const before = await controller.listViews(chrome.origin, undefined, labels)
    chrome.targetsValue.reverse()
    if (abort) chrome.hangingTargetIds.add("B")
    else chrome.unavailableDiagnosticsTargetIds.add("B")
    const listing = controller.listViews(chrome.origin, AbortSignal.timeout(100), knownPackages ? labels : undefined)
    if (abort) await expect(listing).rejects.toMatchObject({name: "TimeoutError"})
    else await expect(listing).rejects.toThrow("indeterminate")
    for (const view of before) expect(controller.getView(view.viewId)).toEqual(view)
    expect(chrome.created).toBe(0)
    expect(chrome.closed).toEqual([])
  })

  test("scoped inventory и действие A не проверяют зависшую вкладку B", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "A", type: "page", title: "A", url: `${chrome.origin}/pkg-fixture-a/`},
      {targetId: "B", type: "page", title: "B", url: `${chrome.origin}/pkg-fixture-b/`},
    ]
    const controller = createController(chrome)
    const labels = [{packageId: "@fixture/a", label: "A"}, {packageId: "@fixture/b", label: "B"}]
    const before = await controller.listViews(chrome.origin, undefined, labels)
    const a = before.find(view => view.packageId === "@fixture/a")!
    const b = before.find(view => view.packageId === "@fixture/b")!
    chrome.hangingTargetIds.add("B")
    chrome.targetsValue[1] = {...chrome.targetsValue[1]!, title: "Непроверенное новое имя B"}
    chrome.targetOperations.length = 0
    const views = await controller.listViews(chrome.origin, AbortSignal.timeout(100), labels, "@fixture/a")
    expect(views).toEqual([a])
    expect(controller.getView(b.viewId)).toEqual(b)
    await controller.interact({viewId: a.viewId, action: "click", target: {nodeId: "node:1"}})
    expect(chrome.targetOperations).not.toContain("identity:B")
    expect(chrome.created).toBe(0)
    expect(chrome.closed).toEqual([])
  })

  test.each(["closed", "moved"])("scoped inventory удаляет доказанно устаревший A, сохраняя B: %s", async change => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "A", type: "page", title: "A", url: `${chrome.origin}/pkg-fixture-a/`},
      {targetId: "B", type: "page", title: "B", url: `${chrome.origin}/pkg-fixture-b/`},
    ]
    const controller = createController(chrome)
    const labels = [{packageId: "@fixture/a", label: "A"}, {packageId: "@fixture/b", label: "B"}]
    const before = await controller.listViews(chrome.origin, undefined, labels)
    const a = before.find(view => view.packageId === "@fixture/a")!
    const b = before.find(view => view.packageId === "@fixture/b")!
    if (change === "closed") chrome.targetsValue.shift()
    else chrome.targetsValue[0] = {...chrome.targetsValue[0]!, url: `${chrome.origin}/pkg-fixture-b/changed`}
    expect(await controller.listViews(chrome.origin, undefined, labels, "@fixture/a")).toEqual([])
    expect(() => controller.getView(a.viewId)).toThrow("Unknown")
    expect(controller.getView(b.viewId)).toEqual(b)
    await expect(controller.interact({viewId: a.viewId, action: "click", target: {nodeId: "node:1"}})).rejects.toThrow("Unknown")
    expect(chrome.created).toBe(0)
    expect(chrome.closed).toEqual([])
  })

  test("inspect exposes bootstrap diagnostics for an attested page without a bridge", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage(openInput(chrome))
    chrome.markerOnlyTargetIds.add(chrome.targetId)
    const result = await controller.inspect(opened.view.viewId, {include: ["state", "diagnostics", "console"]})
    expect(result.ready).toBe(false)
    expect(result.bridgeAvailable).toBe(false)
    expect(result.bootstrap).toMatchObject({markers: {packageId: "@fixture/a"}})
    expect(result.console).toEqual([])
    expect(JSON.stringify(result)).not.toContain(chrome.targetId)
    chrome.targetsValue = chrome.targetsValue.map(target => ({...target, url: "https://example.com/foreign"}))
    await expect(controller.inspect(opened.view.viewId, {include: ["console"]})).rejects.toThrow("navigated away")
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

  test("adopts an attested package target from the previous server origin", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [{
      targetId: "OLD_TARGET",
      type: "page",
      title: "Old Storybook",
      url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default",
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

  test("reuses a matching package tab without closing peers or stealing focus", async () => {
    const chrome = new FakeChrome()
    chrome.targetsValue = [
      {targetId: "OLD_A", type: "page", title: "A", url: "http://127.0.0.1:41000/pkg-fixture-a/fixture/a/default"},
      {targetId: "OLD_B", type: "page", title: "B", url: "http://127.0.0.1:42000/pkg-fixture-a/fixture/a/default"},
    ]
    const opened = await createController(chrome).openPackage(openInput(chrome))
    expect(opened.reused).toBeTrue()
    expect(chrome.closed).toEqual([])
    expect(chrome.activated).toEqual([])
    expect(chrome.targetsValue).toHaveLength(2)
  })

  test("prefers the agent's existing matching view without changing its peers", async () => {
    const chrome = new FakeChrome()
    const root = temporaryRoot()
    chrome.targetsValue = [
      {targetId: "USER", type: "page", title: "User", url: openInput(chrome).url},
      {targetId: "AGENT", type: "page", title: "Agent", url: `${chrome.origin}/pkg-fixture-a/fixture/a/alternate`},
    ]
    new StorybookBrowserState(join(root, "state")).writeTarget({packageId: "@fixture/a", cdpOrigin: chrome.cdp, browserIdentity: "a".repeat(64), targetId: "AGENT"})
    const views = await createController(chrome, root).listViews(chrome.origin)
    expect(views[0]?.route).toBe("fixture/a/alternate")
    expect(chrome.navigations).toBe(0)
    expect(chrome.activated).toEqual([])
    expect(chrome.closed).toEqual([])
  })

  test("lists multiple current package views and refuses stale-handle interactions", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const opened = await controller.openPackage(openInput(chrome))
    chrome.targetsValue.push({targetId: "PEER", type: "page", title: "Peer", url: openInput(chrome).url})
    expect(await controller.listViews(chrome.origin)).toHaveLength(2)
    chrome.targetsValue[0] = {...chrome.targetsValue[0]!, url: `${chrome.origin}/pkg-fixture-b/`}
    await expect(controller.interact({viewId: opened.view.viewId, action: "click", target: {role: "button", name: "Run"}}))
      .rejects.toThrow("navigated away")
    expect(chrome.closed).toEqual([])
  })

  test("preserves a recorded tab whose actual package differs despite the same readable slug", async () => {
    const chrome = new FakeChrome()
    const controller = createController(chrome)
    const first = await controller.openPackage(openInput(chrome))
    chrome.targetsValue[0] = {...chrome.targetsValue[0]!, url: chrome.targetsValue[0]!.url.replace(chrome.origin, "http://127.0.0.1:41000")}
    chrome.identityPackageOverrides.set(chrome.targetId, "fixture-a")
    const opened = await controller.openPackage(openInput(chrome))
    expect(opened.reused).toBeFalse()
    expect(opened.view.viewId).not.toBe(first.view.viewId)
    expect(chrome.created).toBe(2)
    expect(chrome.closed).toEqual([])
    expect(chrome.navigations).toBe(0)
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

  test("reopens the same owned URL once when an earlier bootstrap left no bridge", async () => {
    const chrome = new FakeChrome()
    const input = openInput(chrome)
    chrome.targetsValue = [{targetId: "BROKEN", type: "page", title: "Fixture", url: input.url}]
    chrome.legacyTargetIds.add("BROKEN")
    const navigate = chrome.navigate.bind(chrome)
    chrome.navigate = async (target, url) => {
      await navigate(target, url)
      chrome.legacyTargetIds.delete(target)
    }
    const opened = await createController(chrome).openPackage(input)
    expect(opened.reused).toBe(true)
    expect(chrome.created).toBe(0)
    expect(chrome.navigations).toBe(1)
    expect(chrome.closed).toEqual([])
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
    expect(second.view.viewId).toBe(first.view.viewId)
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

  test("reloads the exact view until the event-selected revision is presented", async () => {
    const chrome = new FakeChrome()
    chrome.identityRevision = "revision-old"
    chrome.revisionAfterNavigate = "revision-next"
    const controller = createController(chrome)
    const opened = await controller.openPackage({
      origin: chrome.origin,
      packageId: "@fixture/a",
      route: "fixture/a/default",
      url: `${chrome.origin}/pkg-fixture-a/fixture/a/default`,
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
      url: `${hangingHealth.origin}/pkg-fixture-a/fixture/a/default`,
      timeoutMs: 100,
    })).rejects.toMatchObject({name: "TimeoutError"})

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
  identityCalls = 0
  identityRevision = "revision-a"
  identityReady = true
  revisionAfterNavigate: string | null = null
  navigations = 0
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
    _params?: unknown,
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
    if (method === "identity") {
      this.identityCalls += 1
      this.targetOperations.push(`identity:${targetId}`)
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
      revision: this.identityRevision,
      graphDigest: "a".repeat(64),
      ready: this.identityReady,
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
