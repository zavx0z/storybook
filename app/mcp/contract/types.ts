import type {StorybookApp} from "@storybook/app"

/** Типы контроллера, нужные для составления публичного Input и внутреннего MCP. */
export type Controller = StorybookApp.Output
export type ControllerContext = Parameters<Controller["ensure"]>[1]
export type ControllerResult = Awaited<ReturnType<Controller["ensure"]>>
