import {expect, test} from "bun:test"
import readStyleSheets from "../index"

test("reads only bounded contiguous indexed Workbench author links", () => {
    const document = indexedLinkDocument([
      {specifier: "@zavx0z/immersive/ui/theme.css", digest: "a".repeat(64), href: "/revision/theme.css"},
      {specifier: "@fixture/tokens.css", digest: "b".repeat(64), href: "/revision/tokens.css"},
    ])
    expect(readStyleSheets(document).map(({id}) => id)).toEqual([
      "@zavx0z/immersive/ui/theme.css",
      "@fixture/tokens.css",
    ])

    const duplicate = indexedLinkDocument([
      {specifier: "@zavx0z/immersive/ui/theme.css", digest: "a".repeat(64), href: "/revision/a.css"},
      {specifier: "@zavx0z/immersive/ui/theme.css", digest: "a".repeat(64), href: "/revision/b.css"},
    ])
    expect(() => readStyleSheets(duplicate)).toThrow("invalid or duplicate")

    const invalidDigest = indexedLinkDocument([
      {specifier: "@zavx0z/immersive/ui/theme.css", digest: "invalid", href: "/revision/theme.css"},
    ])
    expect(() => readStyleSheets(invalidDigest)).toThrow("digest is invalid")
  })

function indexedLinkDocument(
  values: readonly Readonly<{specifier: string; digest: string; href: string}>[],
): globalThis.Document {
  const links: HTMLLinkElement[] = []
  const byId = new Map<string, HTMLLinkElement>()
  const document = {
    readyState: "loading",
    querySelectorAll() {
      return links
    },
    getElementById(id: string) {
      return byId.get(id) ?? null
    },
  } as unknown as globalThis.Document
  for (const [index, value] of values.entries()) {
    const attributes = new Map<string, string>([
      ["rel", "stylesheet"],
      ["href", value.href],
      ["data-external-storybook-author-style-sheet", value.specifier],
      ["data-external-storybook-author-style-sheet-digest", value.digest],
    ])
    const link = {
      localName: "link",
      ownerDocument: document,
      sheet: {},
      getAttribute(name: string) {
        return attributes.get(name) ?? null
      },
    } as unknown as HTMLLinkElement
    links.push(link)
    byId.set(`external-storybook-author-style-sheet-${index}`, link)
  }
  return document
}
