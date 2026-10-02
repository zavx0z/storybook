import type {Document} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import createStorybookComponentPresentation, {type WebPresentation} from "@web/presentation"
type StorybookComponentPresentation = WebPresentation.Output
import {StorybookMessageView, type StorybookMessageViewProps} from "./message-view.tsx"

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
