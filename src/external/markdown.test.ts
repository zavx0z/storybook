import {describe, expect, test} from "bun:test"
import {createDocument, Element, type Node} from "@zavx0z/dom"
import {renderStorybookMarkdown} from "./markdown.ts"

describe("safe Storybook Markdown", () => {
  test("renders headings, paragraphs, lists, code and safe links", () => {
    const document = createDocument()
    const root = renderStorybookMarkdown({
      document,
      baseUrl: "http://127.0.0.1:3000/readme/",
      source: [
        "# Package",
        "",
        "Text with `code` and [owner](./OWNER.md).",
        "",
        "- first",
        "- second",
        "",
        "```ts",
        "const value = 1",
        "```",
      ].join("\n"),
    })
    expect(tags(root)).toEqual(["h1", "p", "code", "a", "ul", "li", "li", "pre", "code"])
    expect(root.textContent).toContain("Package")
    expect(descendants(root).find((node) => node.localName === "a")?.getAttribute("href"))
      .toBe("http://127.0.0.1:3000/readme/OWNER.md")
  })

  test("shows embedded HTML as text and rejects executable links", () => {
    const document = createDocument()
    const root = renderStorybookMarkdown({
      document,
      source: "<script>globalThis.compromised = true</script>\n\n[bad](javascript:alert(1))",
    })
    expect(tags(root)).toEqual(["p", "p"])
    expect(root.textContent).toContain("<script>")
    expect(descendants(root).some((node) => node.localName === "script")).toBeFalse()
    expect(descendants(root).some((node) => node.localName === "a")).toBeFalse()
  })
})

function descendants(root: Node): Element[] {
  const result: Element[] = []
  for (const child of root.childNodes) {
    if (!(child instanceof Element)) continue
    result.push(child, ...descendants(child))
  }
  return result
}

function tags(root: Node): string[] {
  return descendants(root).map((node) => node.localName)
}
