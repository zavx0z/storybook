import {realpathSync} from "node:fs"
import {dirname, resolve} from "node:path"
import {API} from "typescript/unstable/async"
import {SyntaxKind, type Node} from "typescript/unstable/ast"
import {
  isArrowFunction, isBlock, isCallExpression, isExpressionStatement, isFunctionDeclaration,
  isFunctionExpression, isIdentifier, isImportDeclaration, isNamedImports,
  isPropertyAccessExpression, isStringLiteral,
} from "typescript/unstable/ast/is"
import type {ScenarioExecution, ScenarioPreview} from "./types"
import {isPortable, previewPoints} from "./preview-values"

interface FunctionDescriptor {
  readonly path: string
  readonly module: string
  readonly export: string
  readonly local: string
  readonly importSource: string
  readonly locations: readonly {line: number, column: number}[]
}

/**
Находит прямые вызовы публичной функции описываемой сущности внутри внешнего each.
Подготовка, hooks и тела test не выбираются вместо неё. AST только читается.
*/
export async function inspectFunctionScenario(pathInput: string): Promise<FunctionDescriptor | null> {
  const path = realpathSync(resolve(pathInput))
  if (!/\/spec\/[^/]+\.spec\.ts$/u.test(path)) return null
  const entry = resolve(dirname(path), "../index.ts")
  if (!await Bun.file(entry).exists()) return null
  const module = realpathSync(entry)
  const text = await Bun.file(path).text()
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path, module]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const file = await project?.program.getSourceFile(path)
    const ownerProject = await snapshot.getDefaultProjectForFile(module)
    const owner = await ownerProject?.program.getSourceFile(module)
    if (!file || !owner) return null
    const bindings = new Map<string, {export: string, importSource: string}>()
    const describes = new Set<string>()
    for (const statement of file.statements) {
      if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue
      const clause = statement.importClause
      if (!clause || clause.phaseModifier === SyntaxKind.TypeKeyword) continue
      const named = clause.namedBindings
      if (!named || !isNamedImports(named)) continue
      const specifier = statement.moduleSpecifier.text
      if (specifier === "bun:test") {
        for (const binding of named.elements) {
          if (!binding.isTypeOnly && (binding.propertyName?.text ?? binding.name.text) === "describe") describes.add(binding.name.text)
        }
        continue
      }
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue
      let imported: string
      try { imported = realpathSync(Bun.resolveSync(specifier, dirname(path))) } catch { continue }
      if (imported !== module) continue
      for (const binding of named.elements) {
        if (binding.isTypeOnly) continue
        const exported = binding.propertyName?.text ?? binding.name.text
        if (!owner.statements.some(node => isFunctionDeclaration(node) && node.name?.text === exported
          && node.modifiers?.some(modifier => modifier.kind === SyntaxKind.ExportKeyword))) continue
        bindings.set(binding.name.text, {
          export: exported,
          importSource: `import {${exported}${exported === binding.name.text ? "" : ` as ${binding.name.text}`}} from ${JSON.stringify(specifier)}`,
        })
      }
    }
    const calls: {local: string, line: number, column: number}[] = []
    let groups = 0
    const visit = (node: Node): void => {
      if (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node)) return
      if (isCallExpression(node) && isIdentifier(node.expression) && bindings.has(node.expression.text)) {
        const before = text.slice(0, node.getStart(file))
        calls.push({local: node.expression.text, line: before.split("\n").length, column: before.length - before.lastIndexOf("\n")})
      }
      node.forEachChild(visit)
    }
    for (const statement of file.statements) {
      if (!isExpressionStatement(statement) || !isCallExpression(statement.expression)) continue
      const registration = statement.expression
      const each = registration.expression
      if (!isCallExpression(each) || !isPropertyAccessExpression(each.expression)
        || each.expression.name.text !== "each" || !isIdentifier(each.expression.expression)
        || !describes.has(each.expression.expression.text)) continue
      const callback = registration.arguments[1]
      if (!callback || (!isArrowFunction(callback) && !isFunctionExpression(callback)) || !isBlock(callback.body)) continue
      groups++
      callback.body.forEachChild(visit)
    }
    const local = calls[0]?.local
    if (groups !== 1 || !local || calls.some(call => call.local !== local)) return null
    const binding = bindings.get(local)!
    return {path, module, ...binding, local, locations: calls.map(({line, column}) => ({line, column}))}
  } finally {
    await api.close()
  }
}

/** Связывает исходный вызов с наблюдёнными аргументами и исходом того же запуска. */
export function createFunctionPreview(descriptor: FunctionDescriptor, execution: ScenarioExecution): Extract<ScenarioPreview, {kind: "function"}> | undefined {
  const groups = execution.groups.filter(group => group.parentId === null)
  const variants: Extract<ScenarioPreview, {kind: "function"}>["variants"][number][] = []
  for (const group of groups) {
    const observed = execution.calls.filter(call => call.groupId === group.id && call.test === null
      && call.module === descriptor.module && call.name === descriptor.export
      && call.location?.path === descriptor.path
      && descriptor.locations.some(location => location.line === call.location!.line && location.column === call.location!.column))
    if (observed.some(call => !call.args.every(isPortable))) return undefined
    const calls = observed.map(call => ({
      id: call.id,
      source: `${call.outcome.type === "resolve" || call.outcome.type === "reject" ? "await " : ""}${descriptor.local}(${call.args.map(value => JSON.stringify(value, null, 2)).join(", ")})`,
      outcome: structuredClone(call.outcome),
    }))
    variants.push({id: String(group.id), title: group.label,
      source: `${descriptor.importSource}\n\n${calls.map(call => call.source).join("\n\n")}`,
      points: previewPoints(execution, group.id), calls})
  }
  return variants.some(variant => variant.calls.length > 0) ? {kind: "function", variants} : undefined
}
