import type {Document} from "@zavx0z/immersive"
import type {DOMComponentConstructor} from "@zavx0z/immersive"
import createStorybookComponentPresentation, {type StorybookAppWebPagePresentation} from "@zavx0z/storybook-app-web-page-presentation"
type StorybookComponentPresentation = StorybookAppWebPagePresentation.Output
import {StorybookMessageView, type StorybookMessageViewProps} from "./message-view.tsx"

export function createStorybookMessagePresentation(
  document: Document,
  props: StorybookMessageViewProps,
): StorybookComponentPresentation {
  return createStorybookComponentPresentation(
    document,
    StorybookMessageView as unknown as DOMComponentConstructor<StorybookMessageViewProps>,
    props,
    "[data-storybook-message]",
  )
}
