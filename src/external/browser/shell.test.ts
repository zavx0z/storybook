import {describe, expect, test} from "bun:test"
import {createDocument, type Element, type Node} from "@zavx0z/dom"
import type {
  BrowserLinkedAuthorStyleSheetHost,
  DocumentOverlayRuntime,
  DocumentSpaceRuntime,
  DocumentSpaceViewPointSnapshot,
} from "@zavx0z/renderer-browser"
import {
  EXTERNAL_STORYBOOK_WORKBENCH_OVERLAY_ID,
  createExternalStorybookShell,
  type ExternalStorybookShellSpaceRuntimeFactory,
} from "./shell.ts"

describe("external Storybook shared browser shell", () => {
  test("routes bounded keys through the exact Workbench native input owner", async () => {
    const runtimes: FakeRuntime[] = []
    const nativeInput = createFakeNativeInputHarness()
    const document = createDocument()
    const shell = await createExternalStorybookShell({
      title: "Native key fixture",
      document,
      browserDocument: nativeInput.browserDocument,
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      createSpaceRuntime: fakeRuntimeFactory(runtimes, nativeInput),
    })
    const preview = document.createElement("section")
    const target = document.createElement("input")
    target.setAttribute("aria-label", "Exact text input")
    const restoredFocus = document.createElement("button")
    restoredFocus.textContent = "Popover source"
    preview.append(target, restoredFocus)
    shell.mountPreview("Input", preview)
    nativeInput.onKeyDown = () => restoredFocus.focus()

    shell.dispatchNativeKey(target, {
      key: "Escape",
      altKey: true,
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
    })

    expect(nativeInput.activations).toEqual([{
      document,
      ownerId: EXTERNAL_STORYBOOK_WORKBENCH_OVERLAY_ID,
    }])
    expect(nativeInput.synchronizations).toBeGreaterThanOrEqual(3)
    expect(nativeInput.host.inputTarget).toBe(restoredFocus)
    expect(nativeInput.events.map(({type}) => type)).toEqual(["keydown", "keyup"])
    expect(nativeInput.events[0]).toMatchObject({
      key: "Escape",
      bubbles: true,
      cancelable: true,
      composed: true,
      altKey: true,
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
    })

    nativeInput.ownerOverride = "foreign-overlay"
    expect(() => shell.dispatchNativeKey(target, {
      key: "Enter",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toThrow("input owner does not match")
    nativeInput.ownerOverride = null
    nativeInput.proxyMismatch = true
    expect(() => shell.dispatchNativeKey(target, {
      key: "Enter",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toThrow("input proxy does not match")
    nativeInput.proxyMismatch = false
    nativeInput.keyboardEventUnavailable = true
    expect(() => shell.dispatchNativeKey(target, {
      key: "Enter",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toThrow("KeyboardEvent constructor is unavailable")
    expect(nativeInput.events).toHaveLength(2)

    shell.dispose()
  })

  test("awaits exact linked author styles before creating and disposes them after the one runtime", async () => {
    const runtimes: FakeRuntime[] = []
    const lifecycle: string[] = []
    let resolveReady = (): void => {}
    const ready = new Promise<void>((resolve) => { resolveReady = resolve })
    const runtimeFactory = fakeRuntimeFactory(runtimes)
    const creation = createExternalStorybookShell({
      title: "Linked theme",
      document: createDocument(),
      browserDocument: {} as globalThis.Document,
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      authorStyleSheetSources: [{id: "@ui/components/theme.css", link: {} as HTMLLinkElement}],
      createLinkedAuthorStyleSheetHost(options) {
        lifecycle.push("author-create")
        expect(options.sources.map(({id}) => id)).toEqual(["@ui/components/theme.css"])
        return {
          canvas: options.canvas,
          document: options.document,
          sources: options.sources,
          ready: ready.then(() => { lifecycle.push("author-ready") }),
          disposed: false,
          refresh() {},
          dispose() { lifecycle.push("author-dispose") },
        } as BrowserLinkedAuthorStyleSheetHost
      },
      async createSpaceRuntime(options) {
        lifecycle.push("runtime-create")
        const runtime = await runtimeFactory(options)
        return new Proxy(runtime, {
          get(target, property, receiver) {
            if (property !== "dispose") return Reflect.get(target, property, receiver)
            return () => {
              lifecycle.push("runtime-dispose")
              target.dispose()
            }
          },
        })
      },
    })

    await Promise.resolve()
    expect(runtimes).toHaveLength(0)
    resolveReady()
    const shell = await creation
    expect(lifecycle).toEqual(["author-create", "author-ready", "runtime-create"])
    shell.dispose()
    expect(lifecycle).toEqual([
      "author-create",
      "author-ready",
      "runtime-create",
      "runtime-dispose",
      "author-dispose",
    ])
  })

  test("rejects a failed or stalled required author host before creating a runtime and releases it", async () => {
    for (const failure of ["rejected", "stalled"] as const) {
      const runtimes: FakeRuntime[] = []
      let disposals = 0
      const creation = createExternalStorybookShell({
        title: `Author ${failure}`,
        document: createDocument(),
        browserDocument: {} as globalThis.Document,
        canvas: {} as HTMLCanvasElement,
        loadFont: async () => ({}) as never,
        authorStyleSheetSources: [{id: "required-theme", link: {} as HTMLLinkElement}],
        authorStyleSheetReadyTimeoutMs: 5,
        createSpaceRuntime: fakeRuntimeFactory(runtimes),
        createLinkedAuthorStyleSheetHost(options) {
          return {
            canvas: options.canvas,
            document: options.document,
            sources: options.sources,
            ready: failure === "rejected"
              ? Promise.reject(new Error("required theme rejected"))
              : new Promise<void>(() => {}),
            disposed: false,
            refresh() {},
            dispose() { disposals += 1 },
          } as BrowserLinkedAuthorStyleSheetHost
        },
      })
      await expect(creation).rejects.toThrow(
        failure === "rejected" ? "required theme rejected" : "did not become ready",
      )
      expect(runtimes).toHaveLength(0)
      expect(disposals).toBe(1)
    }
  })

  test("owns one semantic Workbench and renderer while exposing same-document host seams", async () => {
    const runtimes: FakeRuntime[] = []
    const document = createDocument()
    const shell = await createExternalStorybookShell({
      title: "Fixture Storybook",
      document,
      browserDocument: {} as globalThis.Document,
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      createSpaceRuntime: fakeRuntimeFactory(runtimes),
    })

    expect(shell.document).toBe(document)
    expect(shell.workbench.document).toBe(document)
    expect(shell.workbench.element).toBe(document.documentElement as typeof shell.workbench.element)
    expect(runtimes).toHaveLength(1)
    const firstRuntime = runtimes[0]!
    expect(firstRuntime.options.document).toBe(document)
    expect(firstRuntime.options.cameraGestures).toBeFalse()
    expect(firstRuntime.overlayId).toBe(EXTERNAL_STORYBOOK_WORKBENCH_OVERLAY_ID)
    expect(firstRuntime.overlayRoot).toBe(shell.workbench.element)
    expect(shell.runtime).toBe(firstRuntime.runtime)
    expect(shell.workbenchOverlay).toBe(firstRuntime.overlay!)
    expect(shell.runtime.document).toBe(document)
    expect(shell.workbenchOverlay.document).toBe(document)
    expect(shell.presentFrame()).toBeGreaterThan(1)

    const preview = document.createElement("button")
    preview.textContent = "Owner preview"
    shell.mountPreview("Owner", preview)
    expect(shell.workbench.elements.displayHost.firstChild).toBe(preview)
    expect(runtimes[0]?.requests).toBeGreaterThan(0)
    expect(() => shell.mountPreview("Foreign", createDocument().createElement("div")))
      .toThrow("another Document")

    shell.workbench.present({
      label: "Owner",
      presentation: {node: preview, projection: "display"},
      inspectorSubject: {
        packageId: "@fixture/components",
        subjectId: "button",
        widgetIds: ["props", "source", "diagnostics"],
      },
      inspectorValues: {
        props: {disabled: false, kind: "owner"},
        source: {
          html: '<button style="opacity: 0.5">Output</button>',
          css: {
            authorStyleSheets: [{
              specifier: "@fixture/components/theme.css",
              cssText: ":root { --tone: #123456; }",
            }],
            componentStyleSheets: [{
              moduleId: "@fixture/components/button.tsx",
              componentName: "Button",
              cssText: "& { color: var(--tone); }\n&:hover { color: white; }",
            }],
          },
          typescript: "export const story = true",
        },
        diagnostics: [],
      },
    })
    shell.reportDiagnostic("fixture diagnostic")
    expect(shell.workbench.elements.inspectorHost.querySelector("aside")?.getAttribute("aria-label"))
      .toBe("Инспектор")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("Исходники")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("Параметры")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("fixture diagnostic")
    const cssFacets = shell.workbench.elements.inspectorHost.querySelectorAll('[data-language-id="css"]')
    expect(cssFacets).toHaveLength(2)
    expect(cssFacets[0]?.querySelector("code")?.textContent).toBe(":root { --tone: #123456; }")
    expect(cssFacets[1]?.querySelector("code")?.textContent).toBe("& { color: var(--tone); }&:hover { color: white; }")
    expect(cssFacets[1]?.querySelector("code")?.querySelectorAll("[data-line-index]")).toHaveLength(2)
    expect(cssFacets[1]?.querySelector("[data-token-category]")).not.toBeNull()
    expect(cssFacets[1]?.querySelector("code")?.textContent).not.toContain("```css")
    expect(cssFacets[1]?.querySelector("code")?.textContent).not.toContain("<style")
    expect(cssFacets[1]?.querySelector("code")?.textContent).not.toContain("css`")
    expect(cssFacets[1]?.querySelector("code")?.textContent).not.toContain("${")
    expect(cssFacets[1]?.querySelector("code")?.textContent).not.toContain("`")
    expect(shell.workbench.elements.inspectorHost.querySelector('[data-language-id="html"] code')?.textContent)
      .toContain('style="opacity: 0.5"')

    const bounds: unknown[] = []
    const unsubscribe = shell.subscribePreviewBounds((value) => bounds.push(value))
    runtimes[0]?.emit(shell.workbench.elements.previewHost, {
      contentX: 12,
      contentY: 18,
      contentWidth: 640,
      contentHeight: 360,
    })
    expect(bounds).toEqual([
      null,
      {x: 12, y: 18, width: 640, height: 360, viewportWidth: 1024, viewportHeight: 768},
    ])
    unsubscribe()

    const worldNode = document.createElement("section")
    const worldResizes: unknown[] = []
    expect(() => shell.mountWorldPreview("Foreign world", {
      node: worldNode,
      space: Object.freeze({}),
      camera: {
        position: {x: 0, y: 0, z: 1},
        target: {x: 0, y: 0, z: 0},
      },
    } as never)).toThrow("registration.space is forbidden")
    expect(runtimes[0]?.forbiddenWorldCalls).toBe(0)
    const worldPreview = shell.mountWorldPreview("Engine", {
      node: worldNode,
      camera: {
        position: {x: 10, y: -20, z: 30},
        target: {x: 0, y: 0, z: 0},
      },
      resize: (viewport) => worldResizes.push(viewport),
    })
    expect(shell.workbench.elements.worldHost.firstChild).toBe(worldNode)
    expect(shell.workbench.element.hasAttribute("data-storybook-world-preview")).toBeTrue()
    const activeRuntime = runtimes[0]!
    expect(shell.runtime.space).toBe(activeRuntime.runtime.space)
    expect(shell.runtime.viewPoint).toBe(activeRuntime.runtime.viewPoint)
    expect(runtimes[0]?.forbiddenWorldCalls).toBe(0)
    expect(runtimes[0]?.restoredViewPoints.at(-1)).toEqual({
      position: {x: 10, y: -20, z: 30},
      target: {x: 0, y: 0, z: 0},
      up: {x: 0, y: 0, z: 1},
      fov: Math.PI / 4,
      near: 1,
      far: 2_000,
    })
    expect(worldResizes.at(-1)).toEqual({
      x: 12,
      y: 18,
      width: 640,
      height: 360,
      backingX: 12,
      backingY: 18,
      backingWidth: 640,
      backingHeight: 360,
      pixelRatio: 1,
    })
    expect(shell.applyWorldPreviewGesture(worldNode, {
      kind: "orbit",
      deltaX: 12,
      deltaY: -7,
    })).toBeTrue()
    expect(runtimes[0]?.viewPointOrbits).toEqual([[12, -7]])
    expect(shell.applyWorldPreviewGesture(document.createElement("div"), {
      kind: "pan",
      deltaX: 1,
      deltaY: 2,
    })).toBeFalse()
    worldPreview.requestRender()
    expect(runtimes[0]?.requests).toBeGreaterThan(0)

    expect(runtimes).toHaveLength(1)
    expect(runtimes[0]?.forbiddenWorldCalls).toBe(0)
    expect(worldPreview.disposed).toBeFalse()
    shell.showMessage("Overview", "Overview", "No direct world")
    expect(worldPreview.disposed).toBeTrue()
    expect(shell.workbench.element.hasAttribute("data-storybook-world-preview")).toBeFalse()
    expect(runtimes[0]?.restoredViewPoints.at(-1)).toEqual(runtimes[0]?.initialViewPoint)
    shell.dispose()
    expect(runtimes[0]?.disposed).toBeTrue()
    expect(shell.workbench.element.parentNode).toBeNull()
  })

  test("renders bounded Markdown and unknown HTML as inert text", async () => {
    const shell = await createExternalStorybookShell({
      title: "Fixture Storybook",
      document: createDocument(),
      browserDocument: {} as globalThis.Document,
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      createSpaceRuntime: fakeRuntimeFactory([]),
    })
    const markdown = shell.showMarkdown(
      "README",
      "# Owner\n\n<script>globalThis.pwned = true</script>\n\n- item",
      "http://localhost/resource",
    )
    expect(markdown.textContent).toContain("Owner")
    expect(markdown.textContent).toContain("<script>globalThis.pwned = true</script>")
    expect(descendants(markdown).some((node) => node.nodeName === "SCRIPT")).toBeFalse()
    shell.dispose()
  })

  test("keeps landing and package pages as separate Experiences", async () => {
    const runtimes: FakeRuntime[] = []
    const landingDocument = createDocument()
    const packageDocument = createDocument()
    const landingCanvas = {} as HTMLCanvasElement
    const packageCanvas = {} as HTMLCanvasElement
    const createSpaceRuntime = fakeRuntimeFactory(runtimes)
    const landing = await createExternalStorybookShell({
      title: "Landing",
      document: landingDocument,
      browserDocument: {} as globalThis.Document,
      canvas: landingCanvas,
      loadFont: async () => ({}) as never,
      createSpaceRuntime,
    })
    const packageShell = await createExternalStorybookShell({
      title: "Package",
      document: packageDocument,
      browserDocument: {} as globalThis.Document,
      canvas: packageCanvas,
      loadFont: async () => ({}) as never,
      createSpaceRuntime,
    })

    expect(landing.document).toBe(landingDocument)
    expect(packageShell.document).toBe(packageDocument)
    expect(landing.runtime.document).toBe(landingDocument)
    expect(packageShell.runtime.document).toBe(packageDocument)
    expect(landing.canvas).toBe(landingCanvas)
    expect(packageShell.canvas).toBe(packageCanvas)
    expect(landing.runtime).not.toBe(packageShell.runtime)
    expect(landing.workbenchOverlay.root).toBe(landing.workbench.element)
    expect(packageShell.workbenchOverlay.root).toBe(packageShell.workbench.element)

    landing.dispose()
    packageShell.dispose()
  })
})

type FakeRuntime = {
  options: Parameters<ExternalStorybookShellSpaceRuntimeFactory>[0]
  runtime: DocumentSpaceRuntime
  overlay: DocumentOverlayRuntime | null
  overlayId: string | null
  overlayRoot: Node | null
  initialViewPoint: DocumentSpaceViewPointSnapshot
  restoredViewPoints: DocumentSpaceViewPointSnapshot[]
  viewPointOrbits: Array<readonly [number, number]>
  forbiddenWorldCalls: number
  requests: number
  disposed: boolean
  emit(node: Node, box: Readonly<{
    contentX: number
    contentY: number
    contentWidth: number
    contentHeight: number
  }>): void
}

function fakeRuntimeFactory(
  output: FakeRuntime[],
  nativeInput?: FakeNativeInputHarness,
): ExternalStorybookShellSpaceRuntimeFactory {
  return (async (options) => {
    const subscribers = new Set<(frame: any) => void>()
    const presentedSubscribers = new Set<(frame: number) => void>()
    let presentedFrames = 0
    let currentFrame: any = frame(options.document, options.document, options.styleSheets)
    let overlay: DocumentOverlayRuntime | null = null
    let overlayId: string | null = null
    let overlayRoot: Node | null = null
    const initialViewPoint = Object.freeze({
      position: Object.freeze({x: 0, y: -1_000, z: 0}),
      target: Object.freeze({x: 0, y: 0, z: 0}),
      up: Object.freeze({x: 0, y: 0, z: 1}),
      fov: Math.PI / 4,
      near: 1,
      far: 2_000,
    })
    let currentViewPoint: DocumentSpaceViewPointSnapshot = initialViewPoint
    const owner: FakeRuntime = {
      options,
      runtime: null as unknown as DocumentSpaceRuntime,
      overlay,
      overlayId,
      overlayRoot,
      initialViewPoint,
      restoredViewPoints: [],
      viewPointOrbits: [],
      forbiddenWorldCalls: 0,
      requests: 0,
      disposed: false,
      emit(node, box) {
        currentFrame = frame(options.document, overlayRoot ?? options.document, options.styleSheets, node, box)
        for (const subscriber of subscribers) subscriber(currentFrame)
      },
    }
    const runtime = {
      document: options.document,
      canvas: options.canvas,
      styleSheets: options.styleSheets,
      font: options.font,
      ...(nativeInput === undefined ? {} : {
        nativeInputHost: nativeInput.host,
        nativeInput: nativeInput.host.nativeInput,
        nativeTextArea: nativeInput.host.nativeTextArea,
        get inputTarget() { return nativeInput.host.inputTarget },
      }),
      space: Object.freeze({kind: "one-shared-space"}),
      viewPoint: {
        orbit(deltaX: number, deltaY: number) {
          owner.viewPointOrbits.push([deltaX, deltaY])
        },
        pan() {},
      },
      worldIds: Object.freeze([]),
      addOverlay(registration: Readonly<{id: string; root: Node}>) {
        overlayId = registration.id
        overlayRoot = registration.root
        overlay = {
          document: options.document,
          root: registration.root,
          styleSheets: options.styleSheets,
          font: options.font,
          get frame() { return currentFrame },
          subscribe(listener: (frame: any) => void) {
            subscribers.add(listener)
            return () => subscribers.delete(listener)
          },
          dispose() {
            subscribers.clear()
          },
        } as unknown as DocumentOverlayRuntime
        owner.overlay = overlay
        owner.overlayId = overlayId
        owner.overlayRoot = overlayRoot
        return overlay
      },
      addWorld(registration: any) {
        owner.forbiddenWorldCalls += 1
        throw new Error(`Second world registration is forbidden: ${String(registration?.id)}`)
      },
      updateWorld() {
        owner.forbiddenWorldCalls += 1
        throw new Error("Second world update is forbidden")
      },
      removeWorld() {
        owner.forbiddenWorldCalls += 1
        throw new Error("Second world removal is forbidden")
      },
      render() {
        for (const subscriber of subscribers) subscriber(currentFrame)
        presentedFrames += 1
        for (const subscriber of presentedSubscribers) subscriber(presentedFrames)
      },
      subscribePresented(listener: (frame: number) => void) {
        presentedSubscribers.add(listener)
        return () => presentedSubscribers.delete(listener)
      },
      requestRender() {
        owner.requests += 1
      },
      snapshotViewPoint() {
        return currentViewPoint
      },
      restoreViewPoint(value: DocumentSpaceViewPointSnapshot) {
        currentViewPoint = value
        owner.restoredViewPoints.push(value)
      },
      dispose() {
        owner.disposed = true
        subscribers.clear()
        presentedSubscribers.clear()
      },
      get disposed() { return owner.disposed },
    } as unknown as DocumentSpaceRuntime
    owner.runtime = runtime
    output.push(owner)
    return runtime
  }) as ExternalStorybookShellSpaceRuntimeFactory
}

type FakeNativeInputHarness = {
  browserDocument: globalThis.Document
  host: DocumentSpaceRuntime["nativeInputHost"]
  activations: Array<Readonly<{
    document: ReturnType<typeof createDocument> | null
    ownerId: string | null
  }>>
  events: KeyboardEvent[]
  synchronizations: number
  ownerOverride: string | null
  proxyMismatch: boolean
  keyboardEventUnavailable: boolean
  onKeyDown: (() => void) | null
}

function createFakeNativeInputHarness(): FakeNativeInputHarness {
  const events: KeyboardEvent[] = []
  const activations: FakeNativeInputHarness["activations"] = []
  const input = new EventTarget()
  const textarea = new EventTarget()
  const foreign = new EventTarget()
  let activeBrowserElement: EventTarget | null = null
  let activeDocument: ReturnType<typeof createDocument> | null = null
  let ownerId: string | null = null
  let inputTarget: FakeNativeInputHarness["host"]["inputTarget"] = null
  let activeProxy: FakeNativeInputHarness["host"]["activeProxy"] = null
  const harness: FakeNativeInputHarness = {
    browserDocument: null as unknown as globalThis.Document,
    host: null as unknown as FakeNativeInputHarness["host"],
    activations,
    events,
    synchronizations: 0,
    ownerOverride: null,
    proxyMismatch: false,
    keyboardEventUnavailable: false,
    onKeyDown: null,
  }
  class FixtureKeyboardEvent extends Event {
    readonly key: string
    readonly altKey: boolean
    readonly ctrlKey: boolean
    readonly metaKey: boolean
    readonly shiftKey: boolean
    constructor(type: string, init: KeyboardEventInit = {}) {
      super(type, init)
      this.key = init.key ?? ""
      this.altKey = init.altKey ?? false
      this.ctrlKey = init.ctrlKey ?? false
      this.metaKey = init.metaKey ?? false
      this.shiftKey = init.shiftKey ?? false
    }
  }
  input.addEventListener("keydown", (event) => {
    events.push(event as KeyboardEvent)
    harness.onKeyDown?.()
  })
  input.addEventListener("keyup", (event) => events.push(event as KeyboardEvent))
  const synchronize = (): void => {
    harness.synchronizations += 1
    inputTarget = activeDocument?.activeElement as typeof inputTarget
    activeProxy = inputTarget === null ? null : "input"
    activeBrowserElement = inputTarget === null
      ? null
      : harness.proxyMismatch ? foreign : input
  }
  harness.host = Object.freeze({
    nativeInput: input as unknown as HTMLInputElement,
    nativeTextArea: textarea as unknown as HTMLTextAreaElement,
    get document() { return activeDocument },
    get ownerId() { return ownerId },
    get inputTarget() { return inputTarget },
    get activeProxy() { return activeProxy },
    setActiveDocument(document, nextOwnerId = null) {
      activeDocument = document
      ownerId = document === null ? null : harness.ownerOverride ?? nextOwnerId
      activations.push({document, ownerId: nextOwnerId})
      synchronize()
    },
    synchronize,
    blur() {
      inputTarget = null
      activeProxy = null
      activeBrowserElement = null
    },
    dispose() {},
  })
  harness.browserDocument = {
    get activeElement() { return activeBrowserElement },
    get defaultView() {
      return harness.keyboardEventUnavailable ? {} : {KeyboardEvent: FixtureKeyboardEvent}
    },
  } as unknown as globalThis.Document
  return harness
}

function frame(
  document: ReturnType<typeof createDocument>,
  root: Node,
  _styleSheets: readonly string[],
  node?: Node,
  box?: Readonly<{
    contentX: number
    contentY: number
    contentWidth: number
    contentHeight: number
  }>,
) {
  return {
    document,
    root,
    viewport: {width: 1024, height: 768},
    boxByNode: node === undefined || box === undefined ? new Map() : new Map([[node, box]]),
  }
}

function descendants(root: Node): Element[] {
  const output: Element[] = []
  for (const child of root.childNodes) {
    if (!("localName" in child)) continue
    output.push(child as Element, ...descendants(child))
  }
  return output
}
