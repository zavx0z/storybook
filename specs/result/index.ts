/**
Возвращает результат чтения спецификации через публичный readSpec.

@packageDocumentation
*/
import readSpec from "@archetypes/spec-reader"
import type {McpRestPackage} from "./contract"

export type {McpRestPackage} from "./contract"
/**
Передаёт чтение спецификации её непосредственному читателю Specs.

@param path - Путь к владельцу спецификации.
@returns Фактический результат readSpec в поле result.
@throws Ошибки чтения и запуска спецификации из readSpec.
*/
export default async function readPackageNode(path: McpRestPackage.Input): Promise<McpRestPackage.Output> {
  return {result: await readSpec({path})}
}
