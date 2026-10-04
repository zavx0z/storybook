import type {StorybookPackageMcpTools} from "@zavx0z/storybook-package-mcp-tools"

type BoundTool = StorybookPackageMcpTools.Output[number]

/** Описание и исполнение инструментов назначенной сущности. */
export declare namespace StorybookAppMcpTools {
  /** Directory и подтверждённый тип приходят от хоста, а не из вызова агента. */
  type Input = Readonly<{
    directory: string
    type?: "Project" | "Repo" | "Component" | "Container" | "Cluster" | "Domain"
  }>
  /** Один набор действует весь срок подключения, независимо от MCP-навигации. */
  type Output = Readonly<{
    list(): readonly Omit<BoundTool, "execute">[]
    call(command: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>
  }>
}
