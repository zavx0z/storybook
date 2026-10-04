import type {Document} from "@zavx0z/immersive-dom"
import type {CompiledTemplate} from "@zavx0z/immersive-template/compiled"
import createStorybookComponentPresentation, {type Zavx0zStorybookAppWebPagePresentation} from "@zavx0z/storybook-app-web-page-presentation"
type StorybookComponentPresentation = Zavx0zStorybookAppWebPagePresentation.Output
import {StorybookMarkdownView, type StorybookMarkdownViewProps} from "./markdown-view.tsx"

export type RenderStorybookMarkdownOptions = StorybookMarkdownViewProps & Readonly<{
  document: Document
}>

export type StorybookMarkdownPresentation = StorybookComponentPresentation & Readonly<{
  update(props: StorybookMarkdownViewProps): void
}>

/** Mounts the production Markdown owner with optional Storybook actions. */
export function renderStorybookMarkdown(
  options: RenderStorybookMarkdownOptions,
): StorybookMarkdownPresentation {
  const template = StorybookMarkdownView as unknown as CompiledTemplate<StorybookMarkdownViewProps>
  const presentation = createStorybookComponentPresentation(
    options.document,
    template,
    {
      source: options.source,
      ...(options.wrap === undefined ? {} : {wrap: options.wrap}),
      ...(options.baseUrl === undefined ? {} : {baseUrl: options.baseUrl}),
      ...(options.action === undefined ? {} : {action: options.action}),
    },
    "[data-storybook-markdown]",
  )
  return Object.freeze({
    ...presentation,
    update(props: StorybookMarkdownViewProps) {
      presentation.componentRoot.render(template, props)
    },
  })
}
