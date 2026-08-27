import {describe, expect, test} from "bun:test"
import {createDocument, Event, type HTMLButtonElement} from "@zavx0z/dom"
import {defineStorybookDomStory, mountStorybookDomStory} from "./stories.ts"

interface NamedButtonStoryArgs {
  label: string
  disabled: boolean
}

const buttonStory = defineStorybookDomStory<NamedButtonStoryArgs>({
  defaultArgs: {label: "Открыть", disabled: false},
  render(document, args, current) {
    const button = (current ?? document.createElement("button")) as HTMLButtonElement
    button.textContent = args.label
    button.disabled = args.disabled
    button.title = args.disabled ? "Действие недоступно" : "Открыть панель"
    return button
  },
  source(args) {
    return {
      html: `<button title="Открыть панель">${args.label}</button>`,
      css: `button { background: #3f5f84; }`,
      typescript: `button.textContent = ${JSON.stringify(args.label)}`,
    }
  },
})

describe("DOM-native Storybook stories", () => {
  test("mounts and updates one real Node in the supplied Document", () => {
    const document = createDocument()
    const host = document.createElement("div")
    document.appendChild(host)
    const controller = mountStorybookDomStory({document, host, story: buttonStory})
    const button = controller.node as HTMLButtonElement
    const clicks: string[] = []
    host.addEventListener("click", () => clicks.push("bubble"))
    button.addEventListener("click", () => clicks.push("target"))

    expect(button.ownerDocument).toBe(document)
    expect(button.parentNode).toBe(host)
    expect(button.textContent).toBe("Открыть")
    expect(button.title).toBe("Открыть панель")
    button.click()
    expect(clicks).toEqual(["target", "bubble"])

    expect(controller.update({label: "Закрыть", disabled: true})).toBe(button)
    expect(controller.node).toBe(button)
    expect(button.textContent).toBe("Закрыть")
    expect(button.disabled).toBeTrue()
    expect(controller.source().html).toContain("Закрыть")

    controller.dispose()
    expect(button.parentNode).toBeNull()
    expect(() => controller.update({disabled: false})).toThrow("disposed")
  })

  test("rejects root replacement, foreign Documents and empty source documents", () => {
    const first = createDocument()
    const second = createDocument()
    const host = first.createElement("div")
    first.appendChild(host)

    const replacing = defineStorybookDomStory({
      defaultArgs: {},
      render(document) {
        return document.createElement("div")
      },
      source: () => ({html: "<div></div>", css: "div {}", typescript: "create()"}),
    })
    const controller = mountStorybookDomStory({document: first, host, story: replacing})
    expect(() => controller.update({})).toThrow("preserve its root Node identity")
    controller.dispose()

    const foreign = defineStorybookDomStory({
      defaultArgs: {},
      render: () => second.createElement("span"),
      source: () => ({html: "<span></span>", css: "span {}", typescript: "create()"}),
    })
    expect(() => mountStorybookDomStory({document: first, host, story: foreign})).toThrow(
      "another Document",
    )

    const empty = defineStorybookDomStory({
      defaultArgs: {},
      render: (document) => document.createElement("div"),
      source: () => ({html: "<div></div>", css: " ", typescript: "create()"}),
    })
    const emptyController = mountStorybookDomStory({document: first, host, story: empty})
    expect(() => emptyController.source()).toThrow("source css must not be empty")
    emptyController.dispose()

    expect(() => host.dispatchEvent(new Event("probe"))).not.toThrow()
  })
})
