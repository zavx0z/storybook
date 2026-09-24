import type {ReadMcpChildrenInput} from "@mcp/children"

/**
Состав подключённых направлений, без зависимости от проекта разработки Storybook.

@property entries - Текущая проекция каталога; пустой список допустим.
*/
export type ReadMcpRootInput = Pick<ReadMcpChildrenInput, "entries">
