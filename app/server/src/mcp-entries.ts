import {type McpRest as McpRestContract} from "@mcp/rest"
import {type AppServerCatalog as AppServerCatalogContract} from "@app-server/catalog"
type StorybookRestOptions = McpRestContract.Input[1]
type ExternalStorybookRegistrySnapshot = ReturnType<AppServerCatalogContract.Output["snapshot"]>
import {dirname, join} from "node:path"

/**
Передаёт в MCP публичную структуру того же каталога, который показывает Workbench.
Категории сохраняют своё место; контракты и сценарии принадлежат точному узлу.
Пути исходников используются читателем и не становятся полями публичного ответа.
*/
export function storybookMcpEntries(snapshot: Pick<ExternalStorybookRegistrySnapshot, "catalog" | "graph">): StorybookRestOptions["entries"] {
  const nodes = snapshot.graph.nodes.filter(node => node.packageId !== null)
  const paths = new Map(nodes.map(node => [node.id, node.urlPath.slice(1)]))
  const descriptions = new Map(snapshot.catalog.scopes.map(scope => [scope.canonicalId, scope.description ?? ""]))
  return nodes.map(node => {
    const directory = node.kind === "package" ? dirname(node.source.path) : node.source.path
    const contract = (direction: "input" | "output" | "slots") => {
      const source = node.contractDocumentation?.sources.find(source => source.sourcePath === join(directory, "contract", `${direction}.ts`))
        ?? node.contractDocumentation?.sources.find(source => source.sourcePath === join(directory, "contract", "index.ts"))
      const schema = node.contractDocumentation?.documents.find(document => document.direction === direction)?.document.declarations[0]?.schema
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
      sources: {
        ...(input === undefined ? {} : {input}),
        ...(output === undefined ? {} : {output}),
        ...(slots === undefined ? {} : {slots}),
        ...(node.scenarioSpec === undefined ? {} : {scenarios: node.scenarioSpec.sourcePaths}),
      },
    }
  })
}
