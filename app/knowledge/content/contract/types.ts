import type {StorybookAppKnowledgeCatalog} from "@zavx0z/storybook-app-knowledge-catalog"

/** Подготовленные источники принадлежат Package, приложение использует его контракт. */
export type McpContentSources = NonNullable<StorybookAppKnowledgeCatalog.Output[number]["sources"]>
export type ContractSchema = NonNullable<NonNullable<McpContentSources["input"]>["schema"]>
