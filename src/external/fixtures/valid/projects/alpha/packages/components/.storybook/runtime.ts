type FixtureElement = {
  textContent: string
  parentNode: {removeChild(node: FixtureElement): void} | null
}

export const runtime = Object.freeze({
  protocol: "storybook-runtime/3",
  create(context: Readonly<{
    document: {createElement(tag: string): FixtureElement}
    present(value: Readonly<{
      protocol: "story-presentation/1"
      node: FixtureElement
      componentRoot: {readStyleSheets(): unknown}
      source: Readonly<{html: string; typescript: string}>
      values?: Readonly<Record<string, unknown>>
    }>): void
  }>) {
    let mounted: FixtureElement | null = null
    return Object.freeze({
      mount(input: Readonly<{story: {label?: string}}>) {
        const element = context.document.createElement("button")
        const label = input.story.label ?? "Fixture story"
        element.textContent = label
        context.present(Object.freeze({
          protocol: "story-presentation/1",
          node: element,
          componentRoot: Object.freeze({
            readStyleSheets: () => Object.freeze({revision: 1, styleSheets: Object.freeze([])}),
          }),
          source: Object.freeze({
            html: `<button>${escapeHtml(label)}</button>`,
            typescript: `<Button label=${JSON.stringify(label)} />`,
          }),
          values: Object.freeze({props: Object.freeze({label})}),
        }))
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

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
