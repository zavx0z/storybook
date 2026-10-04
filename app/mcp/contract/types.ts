import type {Zavx0zStorybookApp} from "@zavx0z/storybook-app"

/** Типы контроллера, нужные для составления публичного Input и внутреннего MCP. */
export type Controller = Zavx0zStorybookApp.Output
export type ControllerContext = Parameters<Controller["ensure"]>[1]
export type ControllerResult = Awaited<ReturnType<Controller["ensure"]>>
