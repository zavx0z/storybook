import {SignatureKind, SymbolFlags, type Project} from "typescript/unstable/async"
import type {SourceFile} from "typescript/unstable/ast"

/** Определяет исполняемую форму публичного default без зависимости от синтаксиса его объявления. */
export async function defaultExportInvocation(
  project: Project,
  file: SourceFile,
): Promise<"call" | "construct" | null> {
  const module = await project.checker.getSymbolAtLocation(file)
  if (!module) return null
  const exported = (await project.checker.getExportsOfModule(module)).find(symbol => symbol.name === "default")
  if (!exported) return null
  const target = exported.flags & SymbolFlags.Alias ? await project.checker.getAliasedSymbol(exported) : exported
  const type = await project.checker.getTypeOfSymbol(target)
  if (!type) throw new Error(`Не разрешён тип default экспорта: ${file.fileName}`)
  if ((await project.checker.getSignaturesOfType(type, SignatureKind.Call)).length > 0) return "call"
  if ((await project.checker.getSignaturesOfType(type, SignatureKind.Construct)).length > 0) return "construct"
  return null
}
