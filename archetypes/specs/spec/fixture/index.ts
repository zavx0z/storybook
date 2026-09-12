/**
Проверяет форму объявлений Bun в исходнике без исполнения тестов.

@packageDocumentation
*/
import {API} from "typescript/unstable/async"
import type {Node} from "typescript/unstable/ast"
import {
  isArrowFunction,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isPropertyAccessExpression,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import {fileURLToPath} from "node:url"
import {lstat, readdir} from "node:fs/promises"
import {basename, join, resolve} from "node:path"

/**
Проверяет параметризацию переданного исходника или spec-файлов непосредственно в директории.
Вложенные фикстуры и спецификации других владельцев не обходятся.

@param path - Путь к директории spec или к одному исходнику.
@returns Нарушения с именами файлов; пустой список означает отсутствие нарушений.
*/
export async function checkSpecParameterization(path: string): Promise<readonly string[]> {
  path = resolve(path)
  const info = await lstat(path)
  if (info.isFile()) {
    return (await findUnparameterizedDescribes(path)).map(name => `${basename(path)}: ${name}`)
  }
  if (!info.isDirectory()) throw new Error(`Ожидался исходник или директория: ${path}`)
  const entries = await readdir(path, {withFileTypes: true})
  const violations: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !/\.spec\.tsx?$/u.test(entry.name)) continue
    for (const name of await findUnparameterizedDescribes(join(path, entry.name))) {
      violations.push(`${entry.name}: ${name}`)
    }
  }
  return violations
}

/**
Находит объявления describe, в цепочке которых отсутствует each.
Обычные test допустимы: параметризация отдельного теста необязательна.
Учитывает именованные импорты из bun:test, их псевдонимы и модификаторы skipIf/only/skip.
Вызовы настройки each и skipIf сами по себе не считаются объявлениями тестов.

@param path - Абсолютный путь к проверяемому исходнику.

@returns Имена нарушающих правило объявлений в порядке исходника.

@throws Ошибки чтения и получения AST файла.
*/
export async function findUnparameterizedDescribes(path: string): Promise<readonly string[]> {
  const api = new API({cwd: fileURLToPath(new URL("../../../../../", import.meta.url))})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const source = await project?.program.getSourceFile(path)
    if (!source) throw new Error(`Не найден исходник: ${path}`)
    const imports = new Map<string, string>()
    for (const statement of source.statements) {
      if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== "bun:test") continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !isNamedImports(bindings)) continue
      for (const binding of bindings.elements) {
        const name = binding.propertyName?.text ?? binding.name.text
        if (name === "describe") imports.set(binding.name.text, name)
      }
    }
    const chain = (node: Node): {name: string, each: boolean} | null => {
      if (isIdentifier(node)) {
        const name = imports.get(node.text)
        return name ? {name, each: false} : null
      }
      if (isCallExpression(node)) return chain(node.expression)
      if (isPropertyAccessExpression(node)) {
        const parent = chain(node.expression)
        return parent ? {name: parent.name, each: parent.each || node.name.text === "each"} : null
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
        if (declaration && !declaration.each && !factory
          && ((title && isStringLiteral(title)) || (callback && (isArrowFunction(callback) || isFunctionExpression(callback))))) {
          violations.push(declaration.name)
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
