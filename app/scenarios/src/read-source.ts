import {API} from "typescript/unstable/async"
import type {Node} from "typescript/unstable/ast"
import {
  isJsxElement, isJsxOpeningElement, isJsxSelfClosingElement, isJsxFragment, isParenthesizedExpression, isArrowFunction, isCallExpression, isFunctionExpression, isFunctionDeclaration, isIdentifier, isImportDeclaration,
  isNamedImports, isPropertyAccessExpression, isStringLiteral, isNoSubstitutionTemplateLiteral,
  isTemplateExpression, isBlock, isExpressionStatement, isObjectLiteralExpression, isPropertyAssignment, isShorthandPropertyAssignment, isComputedPropertyName, isNumericLiteral,
} from "typescript/unstable/ast/is"
import {dirname, resolve} from "node:path"
import {realpath} from "node:fs/promises"
import {SyntaxKind} from "typescript/unstable/ast"
import type {ScenarioSource} from "./types"

/** Читает объявления как данные; не регистрирует и не исполняет тесты проверяемого исходника. */
export async function readScenarioSource(input: string): Promise<ScenarioSource> {
  const path = await realpath(resolve(input))
  const text = await Bun.file(path).text()
  const owner = dirname(dirname(path))
  let entry: string | undefined
  for (const candidate of [resolve(owner, "index.tsx"), resolve(owner, "index.ts")]) {
    if (await Bun.file(candidate).exists()) { entry = candidate; break }
  }
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path, ...(entry ? [entry] : [])]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const file = await project?.program.getSourceFile(path)
    if (!file) throw new Error(`Не найден исходник ${path}`)
    const ownerProject = entry ? await snapshot.getDefaultProjectForFile(entry) : undefined
    const ownerFile = entry ? await ownerProject?.program.getSourceFile(entry) : undefined
    const declaration = ownerFile?.statements.find(node => isFunctionDeclaration(node)
      && node.modifiers?.some(modifier => modifier.kind === SyntaxKind.ExportKeyword))
    const invocations: NonNullable<ScenarioSource["subject"]>["calls"][number][] = []
    const subjectBindings: Node[] = []
    const ownerBindings: {name: Node; exported: string}[] = []
    const invocationCandidates: {callee: Node; value: typeof invocations[number]}[] = []
    let subject: ScenarioSource["subject"] = entry && declaration && isFunctionDeclaration(declaration) && declaration.name
      ? {kind: entry.endsWith(".tsx") ? "component" : "function", module: entry, name: declaration.name.text, calls: invocations} : null
    const native = new Map<string, string>()
    const imports: string[] = []
    const nativeMembers = new Set<string>()
    for (const statement of file.statements) {
      if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue
      imports.push(statement.moduleSpecifier.text)
      const bindings = statement.importClause?.namedBindings
      if (subject && bindings && isNamedImports(bindings) && statement.moduleSpecifier.text !== "bun:test") {
        try {
          if (Bun.resolveSync(statement.moduleSpecifier.text, dirname(path)) === subject.module) {
            for (const binding of bindings.elements) if (!binding.isTypeOnly) ownerBindings.push({name: binding.name, exported: binding.propertyName?.text ?? binding.name.text})
          }
        } catch { /* Неразрешённый импорт остаётся диагностикой запуска. */ }
      }
      if (statement.moduleSpecifier.text !== "bun:test" || !bindings || !isNamedImports(bindings)) continue
      for (const binding of bindings.elements) native.set(binding.name.text, binding.propertyName?.text ?? binding.name.text)
    }
    if (subject?.kind === "component") {
      let rootName: string | undefined
      const findRoot = (node: Node): void => {
        if (rootName) return
        if (isCallExpression(node) && isPropertyAccessExpression(node.expression) && node.expression.name.text === "render") {
          let argument = node.arguments[0]
          while (argument && isParenthesizedExpression(argument)) argument = argument.expression
          const tag = argument && (isJsxElement(argument) ? argument.openingElement.tagName : isJsxSelfClosingElement(argument) ? argument.tagName : undefined)
          if (tag && isIdentifier(tag)) rootName = ownerBindings.find(binding => isIdentifier(binding.name) && binding.name.text === tag.text)?.exported
        }
        node.forEachChild(findRoot)
      }
      findRoot(file)
      if (rootName) subject = {...subject, name: rootName}
    }
    subjectBindings.push(...ownerBindings.filter(binding => binding.exported === subject?.name).map(binding => binding.name))
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
    const renders: ScenarioSource["renders"][number][] = []
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
    const visit = (node: Node, currentTest: typeof tests[number] | null, scope: "module" | "native" | "helper", depth: number, variant: ReturnType<typeof locationOf> | null) => {
      let callbackNode: Node | undefined
      let groupCallback: Node | undefined
      let eachCallback: Node | undefined
      let selectedTest = currentTest
      if (subject?.kind === "component" && (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) && isIdentifier(node.tagName)) {
        invocationCandidates.push({callee: node.tagName, value: {location: locationOf(node), variant, test: currentTest !== null}})
      }
      if (isCallExpression(node)) {
        if (isPropertyAccessExpression(node.expression) && ["render", "renderComponent"].includes(node.expression.name.text)) {
          let argument = node.arguments[0]
          while (argument && isParenthesizedExpression(argument)) argument = argument.expression
          renders.push({method: node.expression.name.text, arguments: node.arguments.length, jsx: !!argument && (isJsxElement(argument) || isJsxSelfClosingElement(argument) || isJsxFragment(argument)), location: locationOf(node)})
        }
        if (subject?.kind === "function" && isIdentifier(node.expression)) {
          invocationCandidates.push({callee: node.expression, value: {location: locationOf(node), variant, test: currentTest !== null}})
        }
        const owner = chain(node.expression)
        if (owner?.name === "mock" && owner.modifiers.length) nativeMembers.add([owner.name, ...owner.modifiers].join("."))
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
            if (owner.modifiers.includes("each")) eachCallback = callback
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
        child === groupCallback ? depth + 1 : depth, child === eachCallback ? locationOf(node) : variant))
    }
    visit(file, null, "module", 0, null)
    if (subjectBindings.length) {
      const symbols = await project!.checker.getSymbolAtLocation([...subjectBindings, ...invocationCandidates.map(call => call.callee)])
      const imported = new Set(symbols.slice(0, subjectBindings.length).filter(Boolean).map(symbol => symbol!.id))
      symbols.slice(subjectBindings.length).forEach((symbol, index) => {
        if (symbol && imported.has(symbol.id)) invocations.push(invocationCandidates[index]!.value)
      })
    }
    return {
      path, text, subject, native: [...new Set([...native.values(), ...nativeMembers])], imports, assertions, tests, groups, checks, hooks, registrations, renders,
    }
  } finally {
    await api.close()
  }
}
