import type {AppWebProtocol} from "@app-web/protocol"

import type {WebPresentation} from "@web/presentation"
import type {StorybookSpacePreview, StorybookSpacePreviewCamera} from "../contract/preview.ts"

export type ExternalStorybookClientSnapshot = ReturnType<AppWebProtocol.Output["clientSnapshot"]>

export type ExternalStorybookClientNode = ExternalStorybookClientSnapshot["nodes"][number]

export type StorybookComponentPresentation = WebPresentation.Output

export type BoundStorybookSpacePreview = StorybookSpacePreview & Readonly<{
  suspend(): void
  resume(): void
}>

export type StorybookViewPointSnapshot = Required<StorybookSpacePreviewCamera>
