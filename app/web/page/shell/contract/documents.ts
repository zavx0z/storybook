import type {PackageGraphCreate} from "@package-graph/create"

type GraphNode = PackageGraphCreate.Output["nodes"][number]

/** Зависимости из проверенного узла того же графа, который получает Web. */
export type StorybookDependencyCase = NonNullable<GraphNode["dependencySpec"]>["cases"][number]

/** Договор из проверенного узла без повторного разбора исходника в Web. */
export type StorybookContractDocument = NonNullable<GraphNode["contractDocumentation"]>["documents"][number]
