/**
Раскрывает авторские сведения сохранённого Package для его MCP-представлений.
Маршруты следуют общему дереву, а описания, контракты и сценарии читаются
из данных точного владельца. Ленивые поля файлового снимка обращаются к PackageMetadata.
Чтение типа делегируется сохранённой проверке и не запускает сборку.

@packageDocumentation
*/
import type {StorybookPackageMcpSource as Contract} from "./contract"
import {dirname, join} from "node:path"

export type {StorybookPackageMcpSource} from "./contract"

/**
Передаёт в MCP публичную структуру того же каталога, который показывает Workbench.
Категории сохраняют своё место; контракты и сценарии принадлежат точному узлу.
Пути исходников используются читателем и не становятся полями публичного ответа.
У пакетов чтение типа делегируется сохранённой нормативной проверке их ревизии.
Директории и входы сред не наследуют тип содержащего пакета.
Описания и схемы раскрываются по обращению, а не для всех узлов заранее.
*/
export default function storybookMcpEntries(
  snapshot: Contract.Input[0],
  readType: NonNullable<Contract.Input[1]> = async () => ({status: "unknown", reason: "missing-report"}),
): Contract.Output {
  const nodes = snapshot.graph.nodes.filter(node => node.packageId !== null)
  const paths = new Map(nodes.map(node => [node.id, node.urlPath.slice(1)]))
  const scopes = new Map(snapshot.catalog.scopes.map(scope => [scope.canonicalId, scope]))
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
    const entry: Contract.Output[number] = {
      get description() { return node.moduleDocumentation?.markdown ?? scopes.get(node.id)?.description ?? "" },
      path: paths.get(node.id)!,
      label: node.label,
      parent: node.parentId === null ? null : paths.get(node.parentId) ?? null,
      ...(node.kind === "package" ? {readType: () => readType(node.packageId!)} : {}),
      get sources() {
        const input = contract("input")
        const output = contract("output")
        const slots = contract("slots")
        return {
          ...(input === undefined ? {} : {input}),
          ...(output === undefined ? {} : {output}),
          ...(slots === undefined ? {} : {slots}),
          ...(node.scenarioSpec === undefined ? {} : {scenarios: node.scenarioSpec.sourcePaths}),
        }
      },
    }
    Object.defineProperty(entry, "summary", {enumerable: true, get: () => scopes.get(node.id)?.description?.trim() || undefined})
    return entry
  })
}
