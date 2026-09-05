import {describe, expect, test} from "bun:test"
import {createDocument, type HTMLButtonElement} from "@zavx0z/dom"
import {createSpaceElementFactories, type XRDisplayElement} from "@zavx0z/space"
import {createDocumentRenderer, createDocumentInteractionController} from "@zavx0z/renderer"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {StorybookDisplay} from "./browser/display-view.tsx"
import {createStorybookComponentPresentation} from "./browser/component-presentation.ts"
import {
  renderStorybookMarkdown,
} from "./markdown.ts"

describe("safe compiled Storybook Markdown", () => {
  test("a long README scrolls inside the bordered Display's content viewport", () => {
    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const display = createStorybookComponentPresentation<{id: string}, XRDisplayElement>(
      document,
      StorybookDisplay as unknown as CompiledTemplate<{id: string}>,
      {id: "scroll-display"},
      "xr-display",
    )
    const markdown = renderStorybookMarkdown({
      document,
      source: Array.from({length: 40}, (_, index) => `## Heading ${index}\n\nParagraph with enough content to fill the document.`).join("\n\n"),
    })
    document.append(display.element)
    display.element.append(markdown.element)
    const renderer = createDocumentRenderer({
      document,
      root: display.element,
      viewport: {width: 600, height: 300},
      styleSheets: ["xr-display { --widget-box-outline: #333; --font-size-sm: 12px; }"],
    })
    const interaction = createDocumentInteractionController({document})
    try {
      const frame = renderer.flush()
      const section = markdown.element
      const box = frame.boxByNode.get(section)!
      const metrics = frame.scrolls.get(section)!
      expect(box.height).toBe(298)
      expect(metrics.maxScrollTop).toBeGreaterThan(0)
      expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
      interaction.wheel(frame, {clientX: 40, clientY: 40, deltaY: 100})
      const scrolled = renderer.flush()
      expect(scrolled.scrolls.get(section)?.scrollTop).toBeGreaterThan(0)
      expect(scrolled.scrolls.get(display.element)?.scrollTop ?? 0).toBe(0)
      renderer.resize({width: 600, height: 200})
      const resized = renderer.flush()
      expect(resized.boxByNode.get(section)?.height).toBe(198)
      expect(resized.scrolls.get(section)?.scrollTop).toBe(scrolled.scrolls.get(section)?.scrollTop)
      markdown.update({source: "Short README"})
      const short = renderer.flush()
      expect(short.scrolls.get(section)?.maxScrollTop).toBe(0)
      expect(short.scrolls.get(section)?.scrollTop).toBe(0)
    } finally {
      interaction.dispose()
      renderer.dispose()
      markdown.dispose()
      display.dispose()
    }
  })

  test("preserves README images and code links with the registry's root-relative resource base", () => {
    const document = createDocument()
    const baseUrl = "/__storybook/resources/nodes/project%3Afixture/"
    const presentation = renderStorybookMarkdown({
      document,
      baseUrl,
      source: '<div align="center">\n  <img src="docs/image.gif" width="444" />\n</div>\n\n[`docs/README.md`](docs/README.md)',
    })
    try {
      expect(presentation.element.querySelector("img")?.getAttribute("src")).toBe(`${baseUrl}docs/image.gif`)
      expect(presentation.element.querySelector("a")?.getAttribute("href")).toBe(`${baseUrl}docs/README.md`)
      expect(presentation.element.querySelector("a code")?.textContent).toBe("docs/README.md")
    } finally {
      presentation.dispose()
    }
  })

  test("parses and renders headings, paragraphs, lists, code and safe links", () => {
    const source = [
      "# Package",
      "",
      "Text with `code` and [owner](./OWNER.md).",
      "",
      "- first",
      "- second",
      "",
      "1. ordered first",
      "2. ordered second",
      "",
      "```ts",
      "const value = 1",
      "```",
    ].join("\n")
    const document = createDocument()
    const presentation = renderStorybookMarkdown({
      document,
      baseUrl: "http://127.0.0.1:3000/readme/",
      source,
    })
    const root = presentation.element
    expect(root.localName).toBe("section")
    expect(root.querySelector("article")?.hasAttribute("data-markdown")).toBe(true)
    expect(root.querySelector("h1")?.textContent).toBe("Package")
    expect(root.querySelector("p")?.textContent).toContain("Text with code")
    expect(root.querySelector("code")?.textContent).toBe("code")
    expect(root.querySelector("a")?.getAttribute("href"))
      .toBe("http://127.0.0.1:3000/readme/OWNER.md")
    expect(root.querySelector("ul")?.querySelectorAll("li")).toHaveLength(2)
    expect(root.querySelector("ol")?.querySelectorAll("li")).toHaveLength(2)
    expect(root.querySelector('[data-markdown-list="unordered"]')?.localName).toBe("ul")
    expect(root.querySelector('[data-markdown-list="ordered"]')?.localName).toBe("ol")
    expect([...root.querySelectorAll("[data-markdown-block]")]
      .every(element => element.localName === "div")).toBe(true)
    const editor = root.querySelector("[data-language-id]")
    expect(editor?.getAttribute("data-language-id")).toBeTruthy()
    expect(editor?.textContent).toContain("const value = 1")
    expect(presentation.componentRoot.readStyleSheets().styleSheets.length).toBeGreaterThan(0)
    presentation.dispose()
    expect(root.parentNode).toBeNull()
  })

  test("shows embedded HTML as text and rejects executable links", () => {
    const document = createDocument()
    const presentation = renderStorybookMarkdown({
      document,
      source: "<script>globalThis.compromised = true</script>\n\n[bad](javascript:alert(1))",
    })
    const root = presentation.element
    expect(root.querySelectorAll("p")).toHaveLength(2)
    expect(root.textContent).toContain("<script>")
    expect(root.querySelector("script")).toBeNull()
    expect(root.querySelector("a")).toBeNull()
    expect(root.textContent).toContain("bad")
    presentation.dispose()
  })

  test("renders the shared overview action and preserves its activation contract", () => {
    let activations = 0
    const document = createDocument()
    const presentation = renderStorybookMarkdown({
      document,
      source: "# Package",
      action: {
        label: "Открыть пакет",
        title: "Открыть Package",
        activate() { activations += 1 },
      },
    })
    const button = presentation.element.querySelector("button") as HTMLButtonElement | null
    if (button === null) throw new Error("Markdown overview action button is missing")
    expect(button.textContent).toBe("Открыть пакет")
    expect(button.getAttribute("aria-label")).toBe("Открыть Package")
    expect(button.parentElement?.getAttribute("data-storybook-overview-action")).toBe("")
    button.click()
    expect(activations).toBe(1)
    presentation.dispose()
  })

  test("uses no visible imperative element construction or global Markdown CSS", async () => {
    const source = await Bun.file(new URL("./markdown.ts", import.meta.url)).text()
    const view = await Bun.file(new URL("./markdown-view.tsx", import.meta.url)).text()
    const action = await Bun.file(new URL("./components/overview-action-button.tsx", import.meta.url)).text()
    expect(source).not.toContain("createElement(")
    expect(source).not.toContain("storybookMarkdownCss")
    expect(view).toContain('from "@zavx0z/ui/views/markdown"')
    expect(source).not.toContain("parseInline")
    expect(view).not.toContain("function MarkdownBlock")
    expect(view).toContain('from "./components/overview-action-button.tsx"')
    expect(view).not.toContain("codeEditorStyle")
    expect(view).not.toContain("actionStyle")
    expect(view).not.toContain("<section data-markdown-block")
    expect(view).not.toContain("<section data-markdown-list")
    expect(action).toContain('from "@zavx0z/ui/buttons/button"')
    expect(action).toContain('size="large"')
    expect(action).toContain('data-storybook-overview-action=""')
    expect(action).toContain("display: flex;")
    expect(action).toContain("flex-direction: row;")
    expect(action.match(/<Button[\s\S]*?\/>/u)?.[0]).not.toContain("style=")
    expect(view).not.toContain("createElement(")
  })
})
