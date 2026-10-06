import type {StorybookPackageEnv} from "@zavx0z/storybook-package-env"
import type {StorybookAppEnvironmentBinding} from "@zavx0z/storybook-app-environment-binding"

type BoundTool = StorybookAppEnvironmentBinding.Output[number]

/** Описание и исполнение инструментов назначенной сущности. */
export declare namespace StorybookAppEnvironmentTools {
  /** Directory и подтверждённый тип приходят от хоста, а не из вызова агента. */
  type Input = Readonly<{
    directory: string
    declaration?: StorybookPackageEnv.Output
    type?: "Project" | "Repo" | "Component" | "Container" | "Cluster" | "Domain"
    /** Расширения предметного владельца; описание и исполнение предоставляются вместе. */
    extensions?: StorybookAppEnvironmentBinding.Input["extensions"]
  }>
  /** Один набор действует весь срок подключения, независимо от MCP-навигации. */
  type Output = Readonly<{
    list(): readonly Omit<BoundTool, "execute">[]
    call(command: unknown, signal?: AbortSignal, onProgress?: (progress: Readonly<Record<string, unknown>>) => void | Promise<void>): Promise<Record<string, unknown>>
  }>
}
