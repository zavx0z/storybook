import {describe, expect, test} from "bun:test"
import {createDocument, type HTMLButtonElement} from "@zavx0z/dom"
import {createDocumentRenderer} from "@zavx0z/renderer"
import {createStorybookMessagePresentation} from "./message-presentation.ts"

describe("Storybook message presentation ownership", () => {
  test("keeps the semantic article and delegates its visual box and action to production components", () => {
    let activations = 0
    const presentation = createStorybookMessagePresentation(createDocument(), {
      title: "Package unavailable",
      detail: "The last working revision remains active.",
      action: {
        label: "Открыть Нодовую систему",
        title: "Открыть Нодовую систему",
        activate() { activations += 1 },
      },
    })

    expect(presentation.element.localName).toBe("article")
    const pane = presentation.element.querySelector('[data-variant="filled"]')
    expect(pane?.localName).toBe("section")
    expect(pane?.textContent).toContain("Package unavailable")

    const button = presentation.element.querySelector("button") as HTMLButtonElement | null
    if (button === null) throw new Error("Storybook message action button is missing")
    expect(button.getAttribute("data-size")).toBe("large")
    expect(button.textContent).toBe("Открыть Нодовую систему")
    expect(button.parentElement?.getAttribute("data-storybook-overview-action")).toBe("")
    button.click()
    expect(activations).toBe(1)

    presentation.dispose()
    expect(presentation.element.parentNode).toBeNull()
  })

  test("does not reimplement Pane or Button visual ownership", async () => {
    const view = await Bun.file(new URL("./message-view.tsx", import.meta.url)).text()
    const action = await Bun.file(
      new URL("../components/overview-action-button.tsx", import.meta.url),
    ).text()

    expect(view).toContain('from "@zavx0z/ui/surfaces/pane"')
    expect(view).toContain("<Pane")
    expect(view).not.toContain("--widget-box-outline")
    expect(view).not.toContain("--widget-box-background")
    expect(view).not.toContain("border-radius:")
    expect(view).not.toContain("padding:")
    expect(action).toContain('from "@zavx0z/ui/buttons/button"')
    expect(action).toContain('size="large"')
    expect(action).toContain('data-storybook-overview-action=""')
    expect(action).toContain("display: flex;")
    expect(action).toContain("flex-direction: row;")
    expect(action.match(/<Button[\s\S]*?\/>/u)?.[0]).not.toContain("style=")
  })

  test("lets production text buttons take intrinsic content width inside the message column", () => {
    const width = (label: string): number => {
      const document = createDocument()
      const presentation = createStorybookMessagePresentation(document, {
        title: "Package",
        detail: "Open the package",
        action: {
          label,
          title: label,
          activate() {},
        },
      })
      const button = presentation.element.querySelector("button") as HTMLButtonElement | null
      if (button === null) throw new Error(`Storybook message action ${label} is missing`)
      const renderer = createDocumentRenderer({
        document,
        root: presentation.element,
        viewport: {width: 800, height: 300},
      })
      const buttonWidth = renderer.flush().boxByNode.get(button)?.width
      renderer.dispose()
      presentation.dispose()
      if (buttonWidth === undefined) throw new Error(`Storybook message action ${label} has no layout`)
      return buttonWidth
    }

    const shortWidth = width("UI")
    const longWidth = width("Открыть Нодовую систему")
    expect(longWidth).toBeGreaterThan(112)
    expect(longWidth).toBeGreaterThan(shortWidth)
  })
})
