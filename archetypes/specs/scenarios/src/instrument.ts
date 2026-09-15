/**
Преобразует только текст сценария в памяти дочернего процесса.
TypeScript AST задаёт позиции вставок; файл на диске остаётся неизменным.

@packageDocumentation
*/
import {API} from "typescript/unstable/async"
import {SyntaxKind} from "typescript/unstable/ast"
import {registerInsertions} from "./source-location"
import type {
  ArrowFunction,
  CallExpression,
  Expression,
  FunctionExpression,
  Node,
} from "typescript/unstable/ast"
import {
  isArrowFunction,
  isBlock,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isPropertyAccessExpression,
  isStringLiteral,
} from "typescript/unstable/ast/is"
interface Insertion {
  readonly position: number
  readonly text: string
  readonly order: number
}

/** Распознаёт прямой вызов describe/test и цепочки их модификаторов. */
function calledOwner(expression: Expression, bindings: ReadonlyMap<string, string>): "describe" | "test" | null {
  let current = expression
  while (isPropertyAccessExpression(current) || isCallExpression(current)) current = current.expression
  const name = isIdentifier(current) ? bindings.get(current.text) : undefined
  return name === "describe" ? "describe" : name === "test" || name === "it" ? "test" : null
}

/** Находит таблицу параметризации у вложенного вызова each. */
function eachCall(expression: Expression): CallExpression | null {
  if (isCallExpression(expression) && isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "each") return expression
  return isCallExpression(expression) || isPropertyAccessExpression(expression) ? eachCall(expression.expression) : null
}

/** Добавляет контекст внутрь callback bodies, сохраняя исходные строки и оригинальные функции Bun. */
export async function instrument(path: string, source: string): Promise<string> {
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const file = await project?.program.getSourceFile(path)
    if (!file) throw new Error(`Не найден исходный файл для trace: ${path}`)
    const bindings = new Map<string, string>()
    for (const node of file.statements) {
      if (!isImportDeclaration(node) || !isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "bun:test") continue
      const named = node.importClause?.namedBindings
      if (!named || !isNamedImports(named)) continue
      for (const item of named.elements) bindings.set(item.name.text, item.propertyName?.text ?? item.name.text)
    }
    const insertions: Insertion[] = []
    const nativeBindings = new Set<number>()
    let siteIndex = 0
    const locationAt = (position: number) => {
      const before = source.slice(0, position)
      return {path, line: before.split("\n").length, column: before.length - before.lastIndexOf("\n")}
    }
    const visit = (node: Node, parentGroup: string | null): void => {
      if (isCallExpression(node)) {
        let callee = node.expression
        while (isCallExpression(callee) || isPropertyAccessExpression(callee)) callee = callee.expression
        if (isIdentifier(callee) && ["describe", "test", "it", "beforeAll", "afterAll", "beforeEach", "afterEach"].includes(bindings.get(callee.text) ?? "")) {
          const start = callee.getStart(file)
          if (!nativeBindings.has(start)) {
            nativeBindings.add(start)
            insertions.push({position: start, text: 'globalThis[Symbol.for("storybook.trace")].native(', order: 1})
            insertions.push({position: callee.end, text: ")", order: 0})
          }
        }
        if (isPropertyAccessExpression(node.expression)) {
          const matcher = node.expression.name.text
          let target = node.expression.expression
          const modifiers: string[] = []
          while (isPropertyAccessExpression(target)) {
            modifiers.unshift(target.name.text)
            target = target.expression
          }
          if (isIdentifier(target) && bindings.get(target.text) === "expect"
            && !["assertions", "hasAssertions", "extend", "addSnapshotSerializer", "getState", "setState"].includes(matcher)) {
            insertions.push({position: node.expression.getStart(file), text: `globalThis[Symbol.for("storybook.trace")].matcher(${JSON.stringify(matcher)},${JSON.stringify(modifiers)},`, order: 0})
            insertions.push({position: node.expression.end, text: ")", order: 1})
          }
        }
        if (isIdentifier(node.expression) && bindings.get(node.expression.text) === "expect") {
          const site = `expect:${node.getStart(file)}`
          insertions.push({position: node.expression.getStart(file), text: `globalThis[Symbol.for("storybook.trace")].expect(${JSON.stringify(site)},${JSON.stringify(locationAt(node.getStart(file)))},`, order: 0})
          insertions.push({position: node.expression.end, text: ")", order: 1})
        }
        const owner = calledOwner(node.expression, bindings)
        const name = node.arguments[0]
        let callback: ArrowFunction | FunctionExpression | undefined
        for (const [index, argument] of node.arguments.entries()) {
          if (index > 0 && (isArrowFunction(argument) || isFunctionExpression(argument))) callback = argument
        }
        if (owner && name && callback && (owner === "test" || isBlock(callback.body))) {
          const site = `${owner}:${siteIndex++}`
          const groupVariable = `__traceGroup${siteIndex}`
          const selectedEach = eachCall(node.expression)
          const modifiers: string[] = []
          let callee: Expression = node.expression
          while (isCallExpression(callee) || isPropertyAccessExpression(callee)) {
            if (isPropertyAccessExpression(callee)) {
              modifiers.push(callee.name.text)
              callee = callee.expression
            } else {
              if (isPropertyAccessExpression(callee.expression)
                && ["if", "skipIf", "todoIf"].includes(callee.expression.name.text) && callee.arguments[0]) {
                const argument = callee.arguments[0]
                insertions.push({position: argument.getStart(file), text: `globalThis[Symbol.for("storybook.trace")].condition(${JSON.stringify(site)},${JSON.stringify(callee.expression.name.text)},(`, order: 0})
                insertions.push({position: argument.end, text: "))", order: 1})
              }
              callee = callee.expression
            }
          }
          const location = locationAt(node.getStart(file))
          const assertions: {site: string, location: typeof location, source: string, customFailMessage: string | null}[] = []
          const collect = (child: Node): void => {
            if (isCallExpression(child) && isIdentifier(child.expression) && bindings.get(child.expression.text) === "expect") {
              const message = child.arguments[1]
              assertions.push({site: `expect:${child.getStart(file)}`, location: locationAt(child.getStart(file)),
                source: source.slice(child.getStart(file), child.end),
                customFailMessage: message && isStringLiteral(message) ? message.text : null})
            }
            child.forEachChild(collect)
          }
          if (owner === "test") collect(callback.body)
          const comments = source.slice(node.getFullStart(), node.getStart(file))
          const skipReason = comments.match(/@remarks\s+([\s\S]*?)\*\//u)?.[1]?.trim() ?? null
          const declaration = JSON.stringify({site, location, modifiers, each: selectedEach !== null, assertions, skipReason})
          if (selectedEach?.arguments[0]) {
            insertions.push({position: selectedEach.arguments[0].getStart(file), text: `globalThis[Symbol.for("storybook.trace")].table(${JSON.stringify(site)},(`, order: 0})
            insertions.push({position: selectedEach.arguments[0].end, text: "))", order: 1})
          }
          if (owner === "test") {
            insertions.push({position: node.expression.getStart(file), text: `globalThis[Symbol.for("storybook.trace")].testRegistrar(${declaration},${parentGroup ?? "undefined"},`, order: 0})
            insertions.push({position: node.expression.end, text: ")", order: 1})
            node.forEachChild(child => visit(child, parentGroup))
            return
          }
          const asynchronous = callback.modifiers?.some(modifier => modifier.kind === SyntaxKind.AsyncKeyword) ?? false
          const method = selectedEach ? `${owner}Each` : owner
          const argumentsText = `${JSON.stringify(site)},${source.slice(name.getStart(file), name.end)}`
          insertions.push({
            position: node.expression.getStart(file),
            text: `globalThis[Symbol.for("storybook.trace")].register(${declaration},`,
            order: 0,
          })
          insertions.push({position: node.expression.end, text: ")", order: 1})
          insertions.push({
            position: callback.body.getStart(file) + 1,
            text: `return globalThis[Symbol.for("storybook.trace")].${method}(${argumentsText},${asynchronous ? "async " : ""}(${owner === "describe" ? groupVariable : ""})=>{`,
            order: 0,
          })
          insertions.push({position: callback.body.end - 1, text: `},${parentGroup ?? "undefined"})`, order: 1})
          node.forEachChild(child => visit(child, owner === "describe" ? groupVariable : parentGroup))
          return
        }
      }
      node.forEachChild(child => visit(child, parentGroup))
    }
    visit(file, null)
    registerInsertions(path, source, insertions)
    return insertions.sort((left, right) => right.position - left.position || right.order - left.order)
      .reduce((contents, insertion) => contents.slice(0, insertion.position) + insertion.text + contents.slice(insertion.position), source)
  } finally {
    await api.close()
  }
}
