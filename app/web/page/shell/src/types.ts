import type {StorybookAppWebProtocol} from "@storybook-app-web/protocol"

import type {StorybookAppWebPagePresentation} from "@storybook-app-web-page/presentation"
import type {StorybookSpacePreview, StorybookSpacePreviewCamera} from "../contract/preview.ts"

export type ExternalStorybookClientSnapshot = ReturnType<StorybookAppWebProtocol.Output["clientSnapshot"]>

export type ExternalStorybookClientNode = ExternalStorybookClientSnapshot["nodes"][number]

export type StorybookComponentPresentation = StorybookAppWebPagePresentation.Output

export type BoundStorybookSpacePreview = StorybookSpacePreview & Readonly<{
  suspend(): void
  resume(): void
}>

export type StorybookViewPointSnapshot = Required<StorybookSpacePreviewCamera>
