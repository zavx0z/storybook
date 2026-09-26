import {API} from "typescript/unstable/async"
import type {Node} from "typescript/unstable/ast"
import {
  isArrowFunction, isCallExpression, isFunctionExpression, isFunctionDeclaration, isIdentifier, isImportDeclaration,
  isNamedImports, isPropertyAccessExpression, isStringLiteral, isNoSubstitutionTemplateLiteral,
  isTemplateExpression, isBlock, isExpressionStatement, isObjectLiteralExpression, isPropertyAssignment, isShorthandPropertyAssignment, isComputedPropertyName, isNumericLiteral,
} from "typescript/unstable/ast/is"
import {resolve} from "node:path"
import type {ScenarioSource} from "./types"

/** Читает объявления как данные; не регистрирует и не исполняет тесты проверяемого исходника. */
export async function readScenarioSource(input: string): Promise<ScenarioSource> {
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
    const assertions: ScenarioSource["assertions"][number][] = []
    const tests: (Omit<ScenarioSource["tests"][number], "assertions"> & {assertions: number})[] = []
    const groups: {source: string, header: string, setup: string, depth: number, each: boolean}[] = []
    const checks: {source: string, matcher: string, explicitObject: boolean}[] = []
    const hooks: {name: string, source: string}[] = []
    const registrations: ScenarioSource["registrations"][number][] = []
    const locationOf = (node: Node) => {
      const prefix = text.slice(0, node.getStart(file))
      return {path, line: prefix.split("\n").length, column: prefix.length - prefix.lastIndexOf("\n")}
    }
    const textOf = (node: Node) => {
      const start = node.getStart(file)
      const indent = text.slice(text.lastIndexOf("\n", start - 1) + 1, start)
      const source = text.slice(start, node.end)
      if (!/^[ \t]*$/u.test(indent)) return source
      return source.split("\n").map((line, index) => index > 0 && line.startsWith(indent) ? line.slice(indent.length) : line).join("\n")
    }
    const visit = (node: Node, currentTest: typeof tests[number] | null, scope: "module" | "native" | "helper", depth: number) => {
      let callbackNode: Node | undefined
      let groupCallback: Node | undefined
      let selectedTest = currentTest
      if (isCallExpression(node)) {
        const owner = chain(node.expression)
        if (owner?.name === "expect" && owner.modifiers.at(-1)?.startsWith("to")) {
          const expected = node.arguments[0]
          checks.push({
            source: textOf(node), matcher: owner.modifiers.at(-1)!,
            explicitObject: !!expected && isObjectLiteralExpression(expected)
              && expected.properties.every(property => (isPropertyAssignment(property) || isShorthandPropertyAssignment(property))
                && (!isComputedPropertyName(property.name) || isStringLiteral(property.name.expression)
                  || isNoSubstitutionTemplateLiteral(property.name.expression) || isNumericLiteral(property.name.expression))),
          })
        }
        if (owner && ["beforeAll", "afterAll", "beforeEach", "afterEach"].includes(owner.name)) hooks.push({name: owner.name, source: textOf(node)})
        if (owner?.name === "expect" && owner.modifiers.length === 0) {
          const message = node.arguments[1]
          assertions.push({actual: node.arguments[0] ? textOf(node.arguments[0]) : "", message: message ? textOf(message) : null,
            inline: !!message && (isStringLiteral(message) || isNoSubstitutionTemplateLiteral(message) || isTemplateExpression(message)), location: locationOf(node)})
          if (currentTest) currentTest.assertions++
        }
        const callback = node.arguments[1]
        const factory = isPropertyAccessExpression(node.expression) && ["each", "skipIf", "if", "todoIf"].includes(node.expression.name.text)
        if (owner && ["describe", "test", "it"].includes(owner.name) && !factory
          && ((node.arguments[0] && isStringLiteral(node.arguments[0])) || (callback && (isArrowFunction(callback) || isFunctionExpression(callback))))) {
          const prefix = text.slice(node.getFullStart(), node.getStart(file))
          const comment = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*$/u.exec(prefix)?.[1]
          const normalized = comment?.replace(/^\s*\* ?/gmu, "")
          const remarks = normalized?.match(/(?:^|\n)\s*@remarks\b([\s\S]*)/u)?.[1]?.split(/\n\s*@\w+/u)[0]?.trim() || null
          registrations.push({kind: owner.name === "describe" ? "describe" : "test", label: node.arguments[0] ? textOf(node.arguments[0]) : "",
            modifiers: owner.modifiers, depth, scope, remarks, location: locationOf(node)})
        }
        if (owner && ["describe", "test", "it"].includes(owner.name) && callback && (isArrowFunction(callback) || isFunctionExpression(callback))) {
          callbackNode = callback
          const label = node.arguments[0] ? textOf(node.arguments[0]) : ""
          if (owner.name !== "describe") {
            selectedTest = {label, assertions: 0, todo: owner.modifiers.some(name => ["todo", "todoIf"].includes(name)), skippable: owner.modifiers.some(name => ["skip", "skipIf", "if"].includes(name)), source: textOf(node), each: owner.modifiers.includes("each"), location: locationOf(node)}
            tests.push(selectedTest)
          } else {
            groupCallback = callback
            const statements = isBlock(callback.body) ? [...callback.body.statements] : []
            const first = statements.findIndex(statement => isExpressionStatement(statement) && isCallExpression(statement.expression)
              && ["describe", "test", "it"].includes(chain(statement.expression.expression)?.name ?? ""))
            groups.push({source: textOf(node), header: text.slice(node.getStart(file), callback.body.getStart(file)),
              setup: statements.slice(0, first < 0 ? statements.length : first).map(textOf).join("\n"), depth, each: owner.modifiers.includes("each")})
          }
        }
      }
      node.forEachChild(child => visit(child, selectedTest,
        child === callbackNode ? "native" : (isArrowFunction(child) || isFunctionExpression(child) || isFunctionDeclaration(child)) ? "helper" : scope,
        child === groupCallback ? depth + 1 : depth))
    }
    visit(file, null, "module", 0)
    return {
      path, text, native: [...native.values()], imports, assertions, tests, groups, checks, hooks, registrations,
    }
  } finally {
    await api.close()
  }
}
