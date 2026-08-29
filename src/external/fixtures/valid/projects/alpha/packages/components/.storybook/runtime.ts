type FixtureElement = {
  textContent: string
  parentNode: {removeChild(node: FixtureElement): void} | null
}

export const runtime = Object.freeze({
  protocol: "storybook-runtime/1",
  create(context: Readonly<{
    document: {createElement(tag: string): FixtureElement}
    mount(node: FixtureElement): void
  }>) {
    let mounted: FixtureElement | null = null
    return Object.freeze({
      mount(input: Readonly<{story: {label?: string}}>) {
        const element = context.document.createElement("button")
        element.textContent = input.story.label ?? "Fixture story"
        context.mount(element)
        mounted = element
      },
      unmount() {
        const current = mounted
        if (current?.parentNode !== null && current?.parentNode !== undefined) current.parentNode.removeChild(current)
        mounted = null
      },
      dispose() {
        const current = mounted
        if (current?.parentNode !== null && current?.parentNode !== undefined) current.parentNode.removeChild(current)
        mounted = null
      },
    })
  },
})
