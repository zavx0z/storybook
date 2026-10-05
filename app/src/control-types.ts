import type {StorybookAppControl} from "@zavx0z/storybook-app-control"

type Controller = Awaited<ReturnType<StorybookAppControl.Input["controller"]>>

/** Типы общего владельца управления используются App без повторных определений. */
export type StorybookEnsureInput = Parameters<Controller["ensure"]>[0]
export type StorybookStatusInput = Parameters<Controller["status"]>[0]
export type StorybookAttachInput = Parameters<Controller["attach"]>[0]
export type StorybookDetachInput = Parameters<Controller["detach"]>[0]
export type StorybookSearchInput = Parameters<Controller["search"]>[0]
export type StorybookOpenInput = Parameters<Controller["open"]>[0]
export type StorybookWaitInput = Parameters<Controller["wait"]>[0]
export type StorybookInspectInput = Parameters<Controller["inspect"]>[0]
export type StorybookInteractInput = Parameters<Controller["interact"]>[0]
export type StorybookCaptureInput = Parameters<Controller["capture"]>[0]
export type StorybookCheckInput = Parameters<Controller["check"]>[0]
export type StorybookCloseInput = Parameters<Controller["close"]>[0]
export type StorybookStopInput = Parameters<Controller["stop"]>[0]
export type StorybookControllerResult = Awaited<ReturnType<Controller["ensure"]>>
export type StorybookOperationStatus = StorybookControllerResult["status"]
export type StorybookCaptureResult = Awaited<ReturnType<Controller["capture"]>>
export type StorybookCaptureImage = NonNullable<StorybookCaptureResult["image"]>
export type StorybookResourceResult = Awaited<ReturnType<Controller["readResource"]>>
export type StorybookControllerContext = Parameters<Controller["ensure"]>[1]
