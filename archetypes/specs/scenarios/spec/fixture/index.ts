import {API} from "typescript/unstable/async"
import type {Node} from "typescript/unstable/ast"
import {
  isArrowFunction, isCallExpression, isFunctionExpression, isFunctionDeclaration, isIdentifier, isImportDeclaration,
  isNamedImports, isPropertyAccessExpression, isStringLiteral, isNoSubstitutionTemplateLiteral,
  isTemplateExpression,
} from "typescript/unstable/ast/is"
import {resolve} from "node:path"
import {findUnparameterizedDescribes} from "../../../spec/fixture"

/** Читает объявления как данные; не регистрирует и не исполняет тесты проверяемого исходника. */
export async function inspectScenarioSource(input: string) {
  const path = resolve(input)
  const text = await Bun.file(path).text()
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const file = await project?.program.getSourceFile(path)
    if (!file) throw new Error(`Не найден исходник ${path}`)
    const native = new Map<string, string>()
    const imports: string[] = []
    for (const statement of file.statements) {
      if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue
      imports.push(statement.moduleSpecifier.text)
      const bindings = statement.importClause?.namedBindings
      if (statement.moduleSpecifier.text !== "bun:test" || !bindings || !isNamedImports(bindings)) continue
      for (const binding of bindings.elements) native.set(binding.name.text, binding.propertyName?.text ?? binding.name.text)
    }
    const chain = (node: Node): {name: string, modifiers: string[]} | null => {
      if (isIdentifier(node)) {
        const name = native.get(node.text)
        return name ? {name, modifiers: []} : null
      }
      if (isCallExpression(node)) return chain(node.expression)
      if (isPropertyAccessExpression(node)) {
        const parent = chain(node.expression)
        return parent ? {...parent, modifiers: [...parent.modifiers, node.name.text]} : null
      }
      return null
    }
    const assertions: {actual: string, message: string | null, inline: boolean}[] = []
    const tests: {label: string, assertions: number, todo: boolean}[] = []
    const hidden: string[] = []
    const undocumentedSkips: string[] = []
    const textOf = (node: Node) => text.slice(node.getStart(file), node.end)
    const visit = (node: Node, currentTest: typeof tests[number] | null, scope: "module" | "native" | "helper") => {
      let callbackNode: Node | undefined
      let selectedTest = currentTest
      if (isCallExpression(node)) {
        const owner = chain(node.expression)
        if (owner?.name === "expect" && owner.modifiers.length === 0) {
          const message = node.arguments[1]
          assertions.push({actual: node.arguments[0] ? textOf(node.arguments[0]) : "", message: message ? textOf(message) : null,
            inline: !!message && (isStringLiteral(message) || isNoSubstitutionTemplateLiteral(message) || isTemplateExpression(message))})
          if (currentTest) currentTest.assertions++
        }
        const callback = node.arguments[1]
        if (owner && ["describe", "test", "it"].includes(owner.name) && callback && (isArrowFunction(callback) || isFunctionExpression(callback))) {
          callbackNode = callback
          const label = node.arguments[0] ? textOf(node.arguments[0]) : ""
          if (scope === "helper") hidden.push(label)
          if (owner.name !== "describe") {
            selectedTest = {label, assertions: 0, todo: owner.modifiers.some(name => ["todo", "todoIf"].includes(name))}
            tests.push(selectedTest)
          }
          if (owner.modifiers.some(name => ["skip", "skipIf", "if"].includes(name))) {
            const prefix = text.slice(node.getFullStart(), node.getStart(file))
            if (!/@remarks\s+\S/u.test(prefix)) undocumentedSkips.push(label)
          }
        }
      }
      node.forEachChild(child => visit(child, selectedTest,
        child === callbackNode ? "native" : (isArrowFunction(child) || isFunctionExpression(child) || isFunctionDeclaration(child)) ? "helper" : scope))
    }
    visit(file, null, "module")
    return {
      path, text, native: [...native.values()], imports, assertions, tests, hidden, undocumentedSkips,
      unparameterized: await findUnparameterizedDescribes(path),
    }
  } finally {
    await api.close()
  }
}
