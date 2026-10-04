import type {Zavx0zStorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"

import type {Zavx0zStorybookAppWebPagePresentation} from "@zavx0z/storybook-app-web-page-presentation"
import type {StorybookSpacePreview, StorybookSpacePreviewCamera} from "../contract/preview.ts"

export type ExternalStorybookClientSnapshot = ReturnType<Zavx0zStorybookAppWebProtocol.Output["clientSnapshot"]>

export type ExternalStorybookClientNode = ExternalStorybookClientSnapshot["nodes"][number]

export type StorybookComponentPresentation = Zavx0zStorybookAppWebPagePresentation.Output

export type BoundStorybookSpacePreview = StorybookSpacePreview & Readonly<{
  suspend(): void
  resume(): void
}>

export type StorybookViewPointSnapshot = Required<StorybookSpacePreviewCamera>
