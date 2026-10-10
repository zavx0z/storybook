import {DisplayElement} from "@zavx0z/immersive"
import {describe, expect, test} from "bun:test"
import {createDocument, type HTMLButtonElement} from "@zavx0z/immersive"
import {createSpaceElementFactories} from "@zavx0z/immersive/space"
import {createDocumentRenderer, createDocumentInteractionController, readDisplayStyle} from "@zavx0z/immersive/renderer/html"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import {StorybookDisplay} from "../src/display-view.tsx"
import createStorybookComponentPresentation from "@zavx0z/storybook-app-web-page-presentation"
import {renderStorybookMarkdown} from "../src/markdown.ts"

describe("safe compiled Storybook Markdown", () => {
  test("a long README scrolls inside the bordered Display's content viewport", () => {
    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const display = createStorybookComponentPresentation<{id: string}, DisplayElement>(
      document,
      StorybookDisplay as unknown as CompiledTemplate<{id: string}>,
      {id: "scroll-display"},
      "display",
    )
    const markdown = renderStorybookMarkdown({
      document,
      source: Array.from({length: 40}, (_, index) => `## Heading ${index}\n\nParagraph with enough content to fill the document.`).join("\n\n"),
    })
    document.append(display.element)
    display.element.append(markdown.element)
    const surface = readDisplayStyle(document, display.element)
    const renderer = createDocumentRenderer({
      document,
      root: display.element,
      viewport: surface.viewport,
      styleSheets: ["display { border: 1px solid #333; --font-size-sm: 12px; }"],
    })
    const interaction = createDocumentInteractionController({document})
    try {
      const frame = renderer.flush()
      const section = markdown.element
      const box = frame.boxByNode.get(section)!
      const metrics = frame.scrolls.get(section)!
      expect(box.height).toBeCloseTo(surface.viewport.height - 2)
      expect(metrics.maxScrollTop).toBeGreaterThan(0)
      expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
      interaction.wheel(frame, {clientX: 40, clientY: 40, deltaY: 100})
      const scrolled = renderer.flush()
      expect(scrolled.scrolls.get(section)?.scrollTop).toBeGreaterThan(0)
      expect(scrolled.scrolls.get(display.element)?.scrollTop ?? 0).toBe(0)
      renderer.resize(surface.viewport)
      const resized = renderer.flush()
      expect(resized.boxByNode.get(section)?.height).toBeCloseTo(surface.viewport.height - 2)
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


})
