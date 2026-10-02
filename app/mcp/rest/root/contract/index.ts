import type {McpChildren} from "@mcp/children"

/** Контракт корневого входа текущего Project через Storybook MCP. */
export declare namespace McpRoot {
  /** Имя текущего Project и направления его Repo, в том числе пустой список. */
  type Input = Readonly<{projectName: string, entries: McpChildren.Input["entries"]}>

  /** Назначение входа и адреса первого уровня без выбранного path. */
  type Output = Readonly<{
    label?: string
    description: string
    children: McpChildren.Output["children"]
  }>
}
