import {describe, expect, test} from "bun:test"
import {createDocument, type HTMLButtonElement} from "@zavx0z/dom"
import {
  parseStorybookMarkdown,
  renderStorybookMarkdown,
} from "./markdown.ts"

describe("safe compiled Storybook Markdown", () => {
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
    const parsed = parseStorybookMarkdown({
      baseUrl: "http://127.0.0.1:3000/readme/",
      source,
    })
    expect(parsed.blocks.map(({kind}) => kind)).toEqual(["heading", "paragraph", "list", "list", "code"])

    const document = createDocument()
    const presentation = renderStorybookMarkdown({
      document,
      baseUrl: "http://127.0.0.1:3000/readme/",
      source,
    })
    const root = presentation.element
    expect(root.localName).toBe("article")
    expect(root.querySelector('[role="heading"]')?.getAttribute("aria-level")).toBe("1")
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
    expect(view).toContain('from "@zavx0z/ui/views/code-editor"')
    expect(view).toContain('from "./components/overview-action-button.tsx"')
    expect(view).not.toContain("codeEditorStyle")
    expect(view).not.toContain("actionStyle")
    expect(view).not.toContain("<section data-markdown-block")
    expect(view).not.toContain("<section data-markdown-list")
    expect(action).toContain('from "@zavx0z/ui/buttons/button"')
    expect(action).toContain('size="large"')
    expect(action).not.toContain("style={css`")
    expect(view).not.toContain("createElement(")
  })
})
