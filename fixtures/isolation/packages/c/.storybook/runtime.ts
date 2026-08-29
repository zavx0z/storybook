type FixtureNode = {
  textContent: string
  parentNode: {removeChild(node: FixtureNode): void} | null
}

type FixtureContext = Readonly<{
  document: {createElement(name: string): FixtureNode}
  mount(node: FixtureNode): void
  publishProps(value: unknown): void
}>

export const runtime = Object.freeze({
  protocol: "storybook-runtime/1",
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
        context.mount(node)
        context.publishProps(Object.freeze({value: input.story}))
        mounted = node
      },
      unmount: remove,
      dispose: remove,
    })
  },
})
