import createControl from "@zavx0z/storybook-app-control"

const shared = createControl({controller: () => { throw new Error("Схемы не исполняют контроллер") }, lifecycle: true, resources: false})
const schemas = shared.schemas

export const storybookEnsureSchema = schemas["storybook_ensure"]!
export const storybookStatusSchema = schemas["storybook_status"]!
export const storybookAttachSchema = schemas["storybook_attach"]!
export const storybookDetachSchema = schemas["storybook_detach"]!
export const storybookSearchSchema = schemas["storybook_search"]!
export const storybookOpenSchema = schemas["storybook_open"]!
export const storybookWaitSchema = schemas["storybook_wait"]!
export const storybookInspectSchema = schemas["storybook_inspect"]!
export const storybookInteractSchema = schemas["storybook_interact"]!
export const storybookCaptureSchema = schemas["storybook_capture"]!
export const storybookCheckSchema = schemas["storybook_check"]!
export const storybookCloseSchema = schemas["storybook_close"]!
export const storybookStopSchema = schemas["storybook_stop"]!
export const storybookRebuildWebSchema = schemas["storybook_rebuild_web"]!

export const STORYBOOK_TOOL_SCHEMAS = shared.schemas
export type StorybookToolName = keyof typeof STORYBOOK_TOOL_SCHEMAS
export const STORYBOOK_TOOL_NAMES = Object.freeze(shared.tools.map(tool => tool.name))
