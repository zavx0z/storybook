import type {Document, Node} from "@zavx0z/dom"

type StorySource = Readonly<{
  html: string
  typescript: string
}>

type StyleSheetRoot = Readonly<{
  readStyleSheets(): unknown
}>

type StoryPresentation = Readonly<{
  element: Node
  root: StyleSheetRoot
  source: StorySource
  props?: Readonly<Record<string, unknown>>
  dispose(): void
}>

type Story = Readonly<{
  create(document: Document): StoryPresentation
}>

type RuntimeContext = Readonly<{
  document: Document
  present(value: Readonly<{
    protocol: "story-presentation/1"
    node: Node
    componentRoot: StyleSheetRoot
    source: StorySource
    values?: Readonly<Record<string, unknown>>
  }>): void
}>

export const runtime = Object.freeze({
  protocol: "storybook-runtime/3",
  create(context: RuntimeContext) {
    let current: StoryPresentation | null = null
    const remove = (): void => {
      const previous = current
      current = null
      if (previous === null) return
      if (previous.element.parentNode !== null) previous.element.parentNode.removeChild(previous.element)
      previous.dispose()
    }
    const mount = (input: Readonly<{story: unknown}>): void => {
      const descriptor = exactStory(input.story)
      remove()
      const presentation = descriptor.create(context.document)
      if (presentation.element.ownerDocument !== context.document ||
        typeof presentation.root.readStyleSheets !== "function") {
        presentation.dispose()
        throw new Error("Self Storybook story returned a foreign presentation")
      }
      current = presentation
      context.present(Object.freeze({
        protocol: "story-presentation/1",
        node: presentation.element,
        componentRoot: presentation.root,
        source: presentation.source,
        ...(presentation.props === undefined
          ? {}
          : {values: Object.freeze({props: presentation.props})}),
      }))
    }
    return Object.freeze({
      mount,
      update: mount,
      unmount: remove,
      dispose: remove,
    })
  },
})

function exactStory(value: unknown): Story {
  if (value === null || typeof value !== "object" || typeof (value as Partial<Story>).create !== "function") {
    throw new TypeError("Self Storybook story must expose create(document)")
  }
  return value as Story
}
