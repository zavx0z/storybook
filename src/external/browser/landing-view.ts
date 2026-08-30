import type {Document} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {
  createStorybookComponentPresentation,
  type StorybookComponentPresentation,
} from "./component-presentation.ts"
import {
  StorybookMessageView,
  type StorybookMessageViewProps,
} from "./landing-view.tsx"

export type {StorybookOverviewAction} from "./landing-view.tsx"

export function createStorybookMessagePresentation(
  document: Document,
  props: StorybookMessageViewProps,
): StorybookComponentPresentation {
  return createStorybookComponentPresentation(
    document,
    StorybookMessageView as unknown as CompiledTemplate<StorybookMessageViewProps>,
    props,
    "[data-storybook-message]",
  )
}
