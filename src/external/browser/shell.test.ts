import {describe, expect, test} from "bun:test"
import {createDocument, type Element, type Node} from "@zavx0z/dom"
import type {DocumentCanvasRuntime} from "@zavx0z/renderer-browser"
import {
  createExternalStorybookShell,
  type ExternalStorybookShellCanvasRuntimeFactory,
} from "./shell.ts"

describe("external Storybook shared browser shell", () => {
  test("owns one semantic Workbench and renderer while exposing same-document host seams", async () => {
    const runtimes: FakeRuntime[] = []
    const document = createDocument()
    const shell = await createExternalStorybookShell({
      title: "Fixture Storybook",
      document,
      browserDocument: {} as globalThis.Document,
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      createCanvasRuntime: fakeRuntimeFactory(runtimes),
    })

    expect(shell.document).toBe(document)
    expect(shell.workbench.document).toBe(document)
    expect(shell.workbench.element).toBe(document.documentElement as typeof shell.workbench.element)
    expect(runtimes).toHaveLength(1)
    expect(runtimes[0]?.options.document).toBe(document)
    expect(runtimes[0]?.options.root).toBe(shell.workbench.element)
    expect(shell.presentFrame()).toBe(1)

    const preview = document.createElement("button")
    preview.textContent = "Owner preview"
    shell.mountPreview("Owner", preview)
    expect(shell.workbench.elements.previewHost.firstChild).toBe(preview)
    expect(runtimes[0]?.requests).toBeGreaterThan(0)
    expect(() => shell.mountPreview("Foreign", createDocument().createElement("div")))
      .toThrow("another Document")

    shell.publishInspector({kind: "owner"})
    shell.publishSource({typescript: "export const story = true"})
    shell.publishProps({disabled: false})
    shell.reportDiagnostic("fixture diagnostic")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("Inspector")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("Source")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("Props")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("fixture diagnostic")

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

    await shell.setOwnerStyleSheets([".owner { color: red; }"])
    expect(runtimes).toHaveLength(2)
    expect(runtimes[0]?.disposed).toBeTrue()
    expect(runtimes[1]?.options.styleSheets).toContain(".owner { color: red; }")
    shell.dispose()
    expect(runtimes[1]?.disposed).toBeTrue()
    expect(shell.workbench.element.parentNode).toBeNull()
  })

  test("renders bounded Markdown and unknown HTML as inert text", async () => {
    const shell = await createExternalStorybookShell({
      title: "Fixture Storybook",
      document: createDocument(),
      browserDocument: {} as globalThis.Document,
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      createCanvasRuntime: fakeRuntimeFactory([]),
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
})

type FakeRuntime = {
  options: Parameters<ExternalStorybookShellCanvasRuntimeFactory>[0]
  requests: number
  disposed: boolean
  emit(node: Node, box: Readonly<{
    contentX: number
    contentY: number
    contentWidth: number
    contentHeight: number
  }>): void
}

function fakeRuntimeFactory(output: FakeRuntime[]): ExternalStorybookShellCanvasRuntimeFactory {
  return (async (options) => {
    const subscribers = new Set<(frame: any) => void>()
    const owner: FakeRuntime = {
      options,
      requests: 0,
      disposed: false,
      emit(node, box) {
        const frame = {
          viewport: {width: 1024, height: 768},
          boxByNode: new Map([[node, box]]),
        }
        for (const subscriber of subscribers) subscriber(frame)
      },
    }
    output.push(owner)
    return {
      render() {
        const frame = {viewport: {width: 1024, height: 768}, boxByNode: new Map()}
        for (const subscriber of subscribers) subscriber(frame)
        return frame
      },
      requestRender() {
        owner.requests += 1
      },
      subscribe(listener: (frame: any) => void) {
        subscribers.add(listener)
        return () => subscribers.delete(listener)
      },
      dispose() {
        owner.disposed = true
        subscribers.clear()
      },
    } as unknown as DocumentCanvasRuntime
  }) as ExternalStorybookShellCanvasRuntimeFactory
}

function descendants(root: Node): Element[] {
  const output: Element[] = []
  for (const child of root.childNodes) {
    if (!("localName" in child)) continue
    output.push(child as Element, ...descendants(child))
  }
  return output
}
