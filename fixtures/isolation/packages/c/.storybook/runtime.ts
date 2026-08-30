type FixtureNode = {
  textContent: string
  parentNode: {removeChild(node: FixtureNode): void} | null
}

type FixtureContext = Readonly<{
  document: {createElement(name: string): FixtureNode}
  present(value: Readonly<{
    protocol: "story-presentation/1"
    node: FixtureNode
    componentRoot: {readStyleSheets(): unknown}
    source: Readonly<{html: string; typescript: string}>
  }>): void
}>

const componentRoot = Object.freeze({
  readStyleSheets: () => Object.freeze({revision: 1, styleSheets: Object.freeze([])}),
})

export const runtime = Object.freeze({
  protocol: "storybook-runtime/3",
  create(context: FixtureContext) {
    let mounted: FixtureNode | null = null
    const remove = (): void => {
      const current = mounted
      if (current?.parentNode !== null && current?.parentNode !== undefined) {
        current.parentNode.removeChild(current)
      }
      mounted = null
    }
    return Object.freeze({
      mount(input: Readonly<{story: string}>) {
        remove()
        const node = context.document.createElement("p")
        node.textContent = input.story
        context.present(Object.freeze({
          protocol: "story-presentation/1",
          node,
          componentRoot,
          source: Object.freeze({
            html: `<p>${escapeHtml(input.story)}</p>`,
            typescript: `export const story = ${JSON.stringify(input.story)}`,
          }),
        }))
        mounted = node
      },
      unmount: remove,
      dispose: remove,
    })
  },
})

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
