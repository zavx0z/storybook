import type {Project} from "typescript/unstable/async"
import type {Node, SourceFile, VariableStatement} from "typescript/unstable/ast"
import {isIdentifier, isVariableStatement} from "typescript/unstable/ast/is"

/** Сохраняет объявления, от которых зависит единственный JSX; среда запуска остаётся у Bun. */
export async function readPreviewSetup(file: SourceFile, jsx: Node, statements: readonly Node[], checker: Project["checker"]): Promise<readonly VariableStatement[]> {
  const bindings = statements.filter(isVariableStatement).flatMap(statement =>
    statement.declarationList.declarations.filter(declaration => isIdentifier(declaration.name))
      .map(declaration => ({statement, name: declaration.name})))
  const symbols = await checker.getSymbolAtLocation(bindings.map(binding => binding.name))
  const declarations = new Map(symbols.flatMap((symbol, index) => symbol ? [[symbol.id, bindings[index]!.statement] as const] : []))
  const selected = new Set<VariableStatement>()
  const pending = [jsx]
  while (pending.length) {
    const references: Node[] = []
    const visit = (node: Node): void => {
      if (isIdentifier(node)) references.push(node)
      node.forEachChild(visit)
    }
    visit(pending.pop()!)
    for (const symbol of await checker.getSymbolAtLocation(references)) {
      const declaration = symbol && declarations.get(symbol.id)
      if (!declaration || selected.has(declaration)) continue
      if (declaration.pos <= jsx.pos && declaration.end >= jsx.end) {
        throw new Error(`${file.fileName}: JSX ссылается на ещё создаваемый результат render`)
      }
      selected.add(declaration)
      pending.push(declaration)
    }
  }
  return statements.filter(isVariableStatement).filter(statement => selected.has(statement))
}
