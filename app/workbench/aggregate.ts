import type {
  StorybookStoryArgs,
  StorybookStoryControl,
  StorybookStoryModule,
} from "@zavx0z/storybook/stories"

export type StorybookDocumentationAggregateEntry = Readonly<{
  id: string
  label: string
  route: string
  module: StorybookStoryModule
}>

export type StorybookDocumentationAggregateModule = Readonly<{
  kind: "documentation-aggregate"
  defaultArgs: StorybookStoryArgs
  controls: readonly StorybookStoryControl[]
  entries: readonly StorybookDocumentationAggregateEntry[]
  render: StorybookStoryModule["render"]
  source: StorybookStoryModule["source"]
}>

export function createStorybookDocumentationAggregate(input: Readonly<{
  entries: readonly StorybookDocumentationAggregateEntry[]
}>): StorybookDocumentationAggregateModule {
  const entries = Object.freeze([...input.entries])
  return Object.freeze({
    kind: "documentation-aggregate",
    defaultArgs: Object.freeze({}),
    controls: Object.freeze([]),
    entries,
    render() {},
    source() {
      const sources = entries.map(({label, route, module}) => ({
        label,
        route,
        source: module.source(module.defaultArgs),
      }))
      return {
        html: sources.flatMap(({label, route, source}) => [
          `<!-- ${label} · /${route} -->`,
          source.html,
          "",
        ]).join("\n").trimEnd(),
        css: sources.flatMap(({label, route, source}) => [
          `/* ${label} · /${route} */`,
          source.css,
          "",
        ]).join("\n").trimEnd(),
        typescript: sources.flatMap(({label, route, source}) => [
          `// ${label} · /${route}`,
          source.typescript,
          "",
        ]).join("\n").trimEnd(),
      }
    },
  })
}

export function isStorybookDocumentationAggregate(
  module: StorybookStoryModule | StorybookDocumentationAggregateModule,
): module is StorybookDocumentationAggregateModule {
  return "kind" in module && module.kind === "documentation-aggregate"
}
