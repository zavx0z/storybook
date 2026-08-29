import type {Document, Node} from "@zavx0z/dom"

type StorySource = Readonly<{
  html: string
  css: string
  typescript: string
}>

type Story = Readonly<{
  render(document: Document): Node
  source?: StorySource
  props?: Readonly<Record<string, unknown>>
}>

type RuntimeContext = Readonly<{
  document: Document
  mount(node: Node): void
  publishSource(value: unknown): void
  publishProps(value: unknown): void
}>

const ownerCss = `
.external-contract { display: flex; flex-direction: column; width: 100%; height: 100%; gap: 10px; padding: 18px; overflow: auto; border: 1px solid #181818; border-radius: 4px; background: #292929; color: #e8e8e8; }
.external-contract h2 { margin: 0; color: #9fdff3; font-size: 17px; }
.external-contract p, .external-contract code { margin: 0; color: #d0d0d0; font-size: 12px; white-space: normal; }
.external-contract pre { padding: 8px; overflow: auto; border: 1px solid #161616; background: #202020; }
.external-self-button { display: block; width: 220px; height: 34px; padding: 6px 12px; border: 1px solid #31566a; border-radius: 3px; background: #3d7088; color: #f4fbff; }
.external-self-button--outlined { background: transparent; color: #8fd4f5; }
.external-self-button:disabled { border-color: #333333; background: #292929; color: #777777; }
`.trim()

export const runtime = Object.freeze({
  protocol: "storybook-runtime/1",
  create(context: RuntimeContext) {
    let mounted: Node | null = null
    const remove = (): void => {
      const current = mounted
      if (current?.parentNode !== null && current?.parentNode !== undefined) {
        current.parentNode.removeChild(current)
      }
      mounted = null
    }
    const mount = (input: Readonly<{story: unknown}>): void => {
      const story = input.story as Partial<Story>
      if (typeof story.render !== "function") throw new Error("Self Storybook story has no render(document)")
      remove()
      const node = story.render(context.document)
      context.mount(node)
      mounted = node
      context.publishSource(story.source ?? null)
      context.publishProps(story.props ?? Object.freeze({}))
    }
    return Object.freeze({
      styleSheets: Object.freeze([ownerCss]),
      mount,
      update: mount,
      unmount: remove,
      dispose: remove,
    })
  },
})
