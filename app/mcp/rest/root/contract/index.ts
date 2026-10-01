import type {McpChildren} from "@mcp/children"

/** Контракт независимого корневого входа Storybook MCP. */
export declare namespace McpRoot {
  /** Подключённые направления общего каталога, в том числе пустой список. */
  type Input = Readonly<{entries: McpChildren.Input["entries"]}>

  /** Назначение входа и адреса первого уровня без выбранного path. */
  type Output = Readonly<{
    label?: string
    description: string
    children: McpChildren.Output["children"]
  }>
}
