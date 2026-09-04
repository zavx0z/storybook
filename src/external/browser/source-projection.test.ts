import {describe, expect, test} from "bun:test"
import {
  acquireDocumentAuthorStyleSheetOwner,
  createDocument,
} from "@zavx0z/dom"
import {projectStorybookSource} from "./source-projection.ts"

describe("Storybook structured source projection", () => {
  test("combines exact declared author sheets with ordered deduplicated active-root authored CSS", () => {
    const document = createDocument()
    const author = acquireDocumentAuthorStyleSheetOwner(document)
    author.replace([
      {id: "@zavx0z/storybook/workbench.css", cssText: ":root { --workbench: #101010; }"},
      {id: "@zavx0z/ui/themes/theme.css", cssText: ":root { --tone: #123456; }"},
    ])
    let reads = 0
    const sharedSource = Object.freeze({
      kind: "authored-css",
      moduleId: "@zavx0z/ui/buttons/button.tsx",
      componentName: "Button",
      cssText: "color: var(--tone);",
    })
    const root = Object.freeze({
      readStyleSheets() {
        reads += 1
        return Object.freeze({
          revision: 2,
          styleSheets: Object.freeze([
            Object.freeze({id: "button-a", cssText: "[data-z-a] { color: var(--tone); }", source: sharedSource}),
            Object.freeze({id: "button-b", cssText: "[data-z-b] { color: var(--tone); }", source: sharedSource}),
            Object.freeze({id: "icon", cssText: "[data-z-c] { width: 12px; }", source: Object.freeze({
              kind: "authored-css",
              moduleId: "@zavx0z/ui/themes/icons.ts",
              componentName: "Icon",
              cssText: "width: 12px;",
            })}),
          ]),
        })
      },
    })

    expect(projectStorybookSource(
      {html: "<button>Output</button>", typescript: "<Button>Output</Button>"},
      root,
      document,
      ["@zavx0z/ui/themes/theme.css"],
    )).toEqual({
      html: "<button>Output</button>",
      css: {
        authorStyleSheets: [{
          specifier: "@zavx0z/ui/themes/theme.css",
          cssText: ":root { --tone: #123456; }",
        }],
        componentStyleSheets: [
          {
            moduleId: "@zavx0z/ui/buttons/button.tsx",
            componentName: "Button",
            cssText: "color: var(--tone);",
          },
          {
            moduleId: "@zavx0z/ui/themes/icons.ts",
            componentName: "Icon",
            cssText: "width: 12px;",
          },
        ],
      },
      typescript: "<Button>Output</Button>",
    })
    expect(reads).toBe(1)
    author.release()
  })

  test("fails closed for legacy source CSS and missing root provenance", () => {
    const document = createDocument()
    expect(() => projectStorybookSource(
      {html: "<button></button>", css: "button {}", typescript: "<Button />"},
      {readStyleSheets: () => ({revision: 1, styleSheets: []})},
      document,
      [],
    )).toThrow("exactly html and typescript")

    expect(() => projectStorybookSource(
      {html: "<button></button>", typescript: "<Button />"},
      {readStyleSheets: () => ({
        revision: 1,
        styleSheets: [{id: "generated-only", cssText: "[data-z-a] {}"}],
      })},
      document,
      [],
    )).toThrow("no authored CSS provenance")
  })

  test("selects active package sheets from the combined Workbench registry and rejects a missing exact id", () => {
    const document = createDocument()
    const author = acquireDocumentAuthorStyleSheetOwner(document)
    author.replace([
      {id: "@zavx0z/storybook/workbench.css", cssText: ":root {}"},
      {id: "unexpected", cssText: ":root {}"},
    ])
    expect(() => projectStorybookSource(
      {html: "", typescript: ""},
      {readStyleSheets: () => ({revision: 0, styleSheets: []})},
      document,
      ["@zavx0z/ui/themes/theme.css"],
    )).toThrow("absent from the exact registry")
    author.release()
  })
})
