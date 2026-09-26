import {API} from "typescript/unstable/async"
import type {Node} from "typescript/unstable/ast"
import {
  isArrowFunction, isCallExpression, isFunctionExpression, isIdentifier,
  isImportDeclaration, isNamedImports, isPropertyAccessExpression, isStringLiteral,
} from "typescript/unstable/ast/is"
import {readFile, readdir} from "node:fs/promises"
import {resolve} from "node:path"
import {fileURLToPath} from "node:url"

/**
Находит пропуски Bun без непустой заметки @remarks перед объявлением.
Читает именованные импорты describe/test и их псевдонимы, не исполняя файл.

@param path - Путь к исходнику.
@returns Имена вызовов skip/skipIf/todo/todoIf без пояснения в порядке исходника.
*/
export async function findUndocumentedSkips(path: string): Promise<readonly string[]> {
  path = resolve(path)
  const text = await readFile(path, "utf8")
  const api = new API({cwd: fileURLToPath(new URL("../../../../../", import.meta.url))})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const source = await project?.program.getSourceFile(path)
    if (!source) throw new Error(`Не найден исходник: ${path}`)
    const bindings = new Map<string, string>()
    for (const node of source.statements) {
      if (!isImportDeclaration(node) || !isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "bun:test") continue
      const imported = node.importClause?.namedBindings
      if (!imported || !isNamedImports(imported)) continue
      for (const item of imported.elements) {
        const name = item.propertyName?.text ?? item.name.text
        if (name === "describe" || name === "test") bindings.set(item.name.text, name)
      }
    }
    const chain = (node: Node): {name: string, skip: string | null} | null => {
      if (isIdentifier(node)) {
        const name = bindings.get(node.text)
        return name ? {name, skip: null} : null
      }
      if (isCallExpression(node)) return chain(node.expression)
      if (isPropertyAccessExpression(node)) {
        const parent = chain(node.expression)
        if (!parent) return null
        return {name: parent.name, skip: ["skip", "skipIf", "todo", "todoIf"].includes(node.name.text) ? node.name.text : parent.skip}
      }
      return null
    }
    const violations: string[] = []
    const visit = (node: Node) => {
      if (isCallExpression(node)) {
        const declaration = chain(node.expression)
        const title = node.arguments[0]
        const callback = node.arguments[1]
        const factory = isPropertyAccessExpression(node.expression)
          && ["each", "skipIf", "if", "todoIf"].includes(node.expression.name.text)
        if (declaration?.skip && !factory
          && ((title && isStringLiteral(title)) || (callback && (isArrowFunction(callback) || isFunctionExpression(callback))))) {
          const prefix = text.slice(node.getFullStart(), node.getStart(source))
          const comment = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*$/u.exec(prefix)?.[1]
          const normalized = comment?.replace(/^\s*\* ?/gmu, "")
          const remarks = normalized?.match(/(?:^|\n)\s*@remarks\b([\s\S]*)/u)?.[1]?.split(/\n\s*@\w+/u)[0]?.trim()
          if (!remarks) violations.push(`${declaration.name}.${declaration.skip}`)
        }
      }
      node.forEachChild(visit)
    }
    visit(source)
    return violations
  } finally {
    await api.close()
  }
}

/** Проверяет заметки о пропусках во всех непосредственных spec-файлах директории. */
export async function checkSkipRemarks(directory: string): Promise<readonly string[]> {
  const violations: string[] = []
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (!entry.isFile() || !/\.spec\.tsx?$/u.test(entry.name)) continue
    for (const violation of await findUndocumentedSkips(resolve(directory, entry.name))) {
      violations.push(`${entry.name}: ${violation}`)
    }
  }
  return violations
}
