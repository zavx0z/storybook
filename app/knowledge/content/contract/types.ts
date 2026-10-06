import type {StorybookPackageEnvSource} from "@zavx0z/storybook-package-env-source"

/** Подготовленные источники принадлежат Package, приложение использует его контракт. */
export type McpContentSources = NonNullable<StorybookPackageEnvSource.Output[number]["sources"]>
export type ContractSchema = NonNullable<NonNullable<McpContentSources["input"]>["schema"]>
