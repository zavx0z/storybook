/**
Преобразует только текст сценария в памяти дочернего процесса.
TypeScript AST задаёт позиции вставок; файл на диске остаётся неизменным.

@packageDocumentation
*/
import {API} from "typescript/unstable/async"
import {SyntaxKind} from "typescript/unstable/ast"
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
  isPropertyAccessExpression,
} from "typescript/unstable/ast/is"
interface Insertion {
  readonly position: number
  readonly text: string
  readonly order: number
}

/** Распознаёт прямой вызов describe/test и цепочки их модификаторов. */
function calledOwner(expression: Expression): "describe" | "test" | null {
  let current = expression
  while (isPropertyAccessExpression(current)) current = current.expression
  if (isCallExpression(current)) current = current.expression
  while (isPropertyAccessExpression(current)) current = current.expression
  return isIdentifier(current) && (current.text === "describe" || current.text === "test") ? current.text : null
}

/** Находит таблицу параметризации у вложенного вызова each. */
function eachCall(expression: Expression): CallExpression | null {
  if (!isCallExpression(expression) || !isPropertyAccessExpression(expression.expression)) return null
  return expression.expression.name.text === "each" ? expression : null
}

/** Добавляет контекст внутрь callback bodies, сохраняя исходные строки и оригинальные функции Bun. */
export async function instrument(path: string, source: string): Promise<string> {
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const file = await project?.program.getSourceFile(path)
    if (!file) throw new Error(`Не найден исходный файл для trace: ${path}`)
    const insertions: Insertion[] = []
    let siteIndex = 0
    const visit = (node: Node, parentGroup: string | null): void => {
      if (isCallExpression(node)) {
        const owner = calledOwner(node.expression)
        const name = node.arguments[0]
        let callback: ArrowFunction | FunctionExpression | undefined
        for (const [index, argument] of node.arguments.entries()) {
          if (index > 0 && (isArrowFunction(argument) || isFunctionExpression(argument))) callback = argument
        }
        if (owner && name && callback && isBlock(callback.body)) {
          const site = `${owner}:${siteIndex++}`
          const groupVariable = `__traceGroup${siteIndex}`
          const selectedEach = eachCall(node.expression)
          if (selectedEach?.arguments[0]) {
            insertions.push({position: selectedEach.arguments[0].getStart(file), text: `globalThis[Symbol.for("storybook.trace")].table(${JSON.stringify(site)},(`, order: 0})
            insertions.push({position: selectedEach.arguments[0].end, text: "))", order: 1})
          }
          const asynchronous = callback.modifiers?.some(modifier => modifier.kind === SyntaxKind.AsyncKeyword) ?? false
          const method = selectedEach ? `${owner}Each` : owner
          const argumentsText = `${JSON.stringify(site)},${source.slice(name.getStart(file), name.end)}`
          insertions.push({
            position: node.getStart(file),
            text: `globalThis[Symbol.for("storybook.trace")].register(${JSON.stringify(site)},${JSON.stringify(parentGroup)},()=>((`,
            order: 0,
          })
          insertions.push({position: node.end, text: ")))", order: 1})
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
    return insertions.sort((left, right) => right.position - left.position || right.order - left.order)
      .reduce((contents, insertion) => contents.slice(0, insertion.position) + insertion.text + contents.slice(insertion.position), source)
  } finally {
    await api.close()
  }
}

