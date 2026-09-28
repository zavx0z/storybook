/**
Находит runtime bindings сценария штатным TypeScript AST.
Наблюдение ограничено импортированными именами; namespace раскрывает весь модуль.
Встроенные модули среды не являются наблюдаемой прикладной логикой.

@packageDocumentation
*/
import {dirname} from "node:path"
import {isBuiltin} from "node:module"
import {API} from "typescript/unstable/async"
import {SyntaxKind} from "typescript/unstable/ast"
import {isImportDeclaration, isNamedImports, isNamespaceImport, isStringLiteral} from "typescript/unstable/ast/is"

/** Разрешает runtime imports и исходные имена экспортов без исполнения сценария. */
export async function readImports(path: string): Promise<{module: string, names: readonly string[] | null}[]> {
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const file = await project?.program.getSourceFile(path)
    if (!file) throw new Error(`Не найден исходник ${path}`)
    const modules = new Map<string, Set<string> | null>()
    for (const statement of file.statements) {
      if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      const clause = statement.importClause
      if (!clause || clause.phaseModifier === SyntaxKind.TypeKeyword || specifier.startsWith("bun:") || isBuiltin(specifier)) continue
      const bindings = clause.namedBindings
      const names = bindings && isNamespaceImport(bindings) ? null : [
        ...(clause.name ? ["default"] : []),
        ...(bindings && isNamedImports(bindings)
          ? bindings.elements.filter(binding => !binding.isTypeOnly).map(binding => binding.propertyName?.text ?? binding.name.text) : []),
      ]
      if (names?.length === 0) continue
      const module = Bun.resolveSync(specifier, dirname(path))
      const previous = modules.get(module)
      modules.set(module, previous === null || names === null ? null : new Set([...previous ?? [], ...names]))
    }
    return [...modules].map(([module, names]) => ({module, names: names === null ? null : [...names]}))
  } finally {
    await api.close()
  }
}
