import {describe, expect, test} from "bun:test"
import {createDocument, type HTMLButtonElement} from "@zavx0z/dom"
import {routeTree} from "../../.storybook/stories/contracts.tsx"
import {
  disabled,
  outlined,
  primary,
} from "../../.storybook/stories/presentation.tsx"
import type {
  SelfStoryDescriptor,
  SelfStoryPresentation,
} from "../../.storybook/stories/story-types.ts"

describe("compiled self Storybook component owners", () => {
  test("presents the production Button with exact authored provenance", () => {
    const cases: readonly Readonly<{
      story: SelfStoryDescriptor
      variant: "contained" | "outlined"
      label: string
      disabled: boolean
    }>[] = [
      {story: primary, variant: "contained", label: "Primary", disabled: false},
      {story: outlined, variant: "outlined", label: "Outlined", disabled: false},
      {story: disabled, variant: "contained", label: "Disabled", disabled: true},
    ]

    for (const canary of cases) {
      const document = createDocument()
      const presentation = canary.story.create(document)
      const button = presentation.element as HTMLButtonElement

      expect(button.ownerDocument).toBe(document)
      expect(button.localName).toBe("button")
      expect(button.getAttribute("data-variant")).toBe(canary.variant)
      expect(button.getAttribute("data-tone")).toBe("primary")
      expect(button.disabled).toBe(canary.disabled)
      expect(button.title).toBe("External Storybook live story")
      expect(button.textContent).toBe(canary.label)
      expect(authoredOwners(presentation)).toContain("@zavx0z/ui/buttons/button.tsx#Button")

      const root = presentation.root
      presentation.dispose()
      expect(() => root.readStyleSheets()).toThrow("unmounted")
    }
  })

  test("composes contract documents from production Pane, Typography and CodeEditor", () => {
    const document = createDocument()
    const presentation = routeTree.create(document)

    expect(presentation.element.ownerDocument).toBe(document)
    expect(presentation.element.localName).toBe("section")
    expect(presentation.element.getAttribute("data-variant")).toBe("filled")
    expect(presentation.element.querySelector("article")).not.toBeNull()
    expect(presentation.element.querySelectorAll("[data-variant=title]")).toHaveLength(1)
    expect(presentation.element.querySelector("[data-language-id]")).not.toBeNull()
    expect(presentation.source.html).toContain("<article")

    const owners = authoredOwners(presentation)
    for (const owner of [
      "@zavx0z/ui/surfaces/pane.tsx#Pane",
      "@zavx0z/ui/typography.tsx#Typography",
      "@zavx0z/ui/views/code-editor.tsx#CodeEditor",
    ]) expect(owners, owner).toContain(owner)

    const root = presentation.root
    presentation.dispose()
    expect(() => root.readStyleSheets()).toThrow("unmounted")
  })
})

function authoredOwners(presentation: SelfStoryPresentation): readonly string[] {
  return presentation.root.readStyleSheets().styleSheets.map((sheet) => {
    if (sheet.source?.kind !== "authored-css") {
      throw new Error(`Self Storybook adopted a stylesheet without authored provenance: ${sheet.id}`)
    }
    return `${sheet.source.moduleId}#${sheet.source.componentName}`
  })
}
