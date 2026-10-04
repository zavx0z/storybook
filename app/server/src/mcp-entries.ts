import {type StorybookAppMcpRest as McpRestContract} from "@storybook-app-mcp/rest"
import {type StorybookAppServerCatalog as AppServerCatalogContract} from "@storybook-app-server/catalog"
type StorybookRestOptions = McpRestContract.Input[1]
type ExternalStorybookRegistrySnapshot = ReturnType<AppServerCatalogContract.Output["snapshot"]>
import {dirname, join} from "node:path"

/**
Передаёт в MCP публичную структуру того же каталога, который показывает Workbench.
Категории сохраняют своё место; контракты и сценарии принадлежат точному узлу.
Пути исходников используются читателем и не становятся полями публичного ответа.
У пакетов чтение типа делегируется сохранённой нормативной проверке их ревизии.
Директории и входы сред не наследуют тип содержащего пакета.
*/
export function storybookMcpEntries(
  snapshot: Pick<ExternalStorybookRegistrySnapshot, "catalog" | "graph">,
  readType: (packageId: string) => ReturnType<NonNullable<StorybookRestOptions["entries"][number]["readType"]>> = async () => ({status: "unknown", reason: "missing-report"}),
): StorybookRestOptions["entries"] {
  const nodes = snapshot.graph.nodes.filter(node => node.packageId !== null)
  const paths = new Map(nodes.map(node => [node.id, node.urlPath.slice(1)]))
  const descriptions = new Map(snapshot.catalog.scopes.map(scope => [scope.canonicalId, scope.description ?? ""]))
  return nodes.map(node => {
    const directory = node.kind === "package" || node.kind === "entry" ? dirname(node.source.path) : node.source.path
    const contract = (direction: "input" | "output" | "slots") => {
      const document = node.contractDocumentation?.documents.find(document => document.direction === direction)
      const source = document?.sourcePath === undefined
        ? node.contractDocumentation?.sources.find(source => source.sourcePath === join(directory, "contract", `${direction}.ts`))
          ?? node.contractDocumentation?.sources.find(source => source.sourcePath === join(directory, "contract", "index.ts"))
        : node.contractDocumentation?.sources.find(source => source.sourcePath === document.sourcePath)
      const schema = document?.document.declarations[0]?.schema
      return source === undefined ? undefined : {path: source.sourcePath, digest: source.sourceDigest, ...(schema === undefined ? {} : {schema})}
    }
    const input = contract("input")
    const output = contract("output")
    const slots = contract("slots")
    const summary = descriptions.get(node.id)?.trim()
    return {
      description: node.moduleDocumentation?.markdown ?? descriptions.get(node.id) ?? "",
      path: paths.get(node.id)!,
      label: node.label,
      ...(summary ? {summary} : {}),
      parent: node.parentId === null ? null : paths.get(node.parentId) ?? null,
      ...(node.kind === "package" ? {readType: () => readType(node.packageId!)} : {}),
      sources: {
        ...(input === undefined ? {} : {input}),
        ...(output === undefined ? {} : {output}),
        ...(slots === undefined ? {} : {slots}),
        ...(node.scenarioSpec === undefined ? {} : {scenarios: node.scenarioSpec.sourcePaths}),
      },
    }
  })
}
