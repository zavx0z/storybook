import {realpathSync} from "node:fs"
import {dirname, resolve} from "node:path"
import {API} from "typescript/unstable/async"
import {SyntaxKind, type Node} from "typescript/unstable/ast"
import {
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isBindingElement,
  isBlock,
  isCallExpression,
  isExpressionStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isNumericLiteral,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import type {ScenarioExecution, ScenarioPreview, TraceValue} from "./types"
import {isPortable, previewPoints} from "./preview-values"

interface SourceReference {
  readonly path: readonly (string | number)[]
  readonly local: string
  readonly importSource: string
}

interface CallSite {
  readonly line: number
  readonly column: number
  readonly propsArgumentIndexes: readonly number[]
}

interface FunctionDescriptor {
  readonly path: string
  readonly module: string
  readonly export: string
  readonly local: string
  readonly importSource: string
  readonly locations: readonly CallSite[]
  readonly referencesByVariant: readonly (readonly SourceReference[])[]
}

/** Убирает синтаксические обёртки, не вычисляя выражение. */
function unwrapExpression(node: Node): Node {
  let current = node
  while (isSatisfiesExpression(current) || isAsExpression(current) || isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

/** Возвращает статическое имя поля объектного литерала. */
function propertyName(node: Node): string | undefined {
  return isIdentifier(node) || isStringLiteral(node) || isNumericLiteral(node) ? node.text : undefined
}

/** Собирает импортированные значения из литерала props с их точным путём. */
function collectSourceReferences(
  node: Node,
  imports: ReadonlyMap<string, string>,
  path: readonly (string | number)[] = [],
): SourceReference[] {
  const current = unwrapExpression(node)
  if (isIdentifier(current)) {
    const importSource = imports.get(current.text)
    return importSource === undefined ? [] : [{path, local: current.text, importSource}]
  }
  if (isArrayLiteralExpression(current)) {
    return current.elements.flatMap((item, index) => collectSourceReferences(item, imports, [...path, index]))
  }
  if (!isObjectLiteralExpression(current)) return []
  return current.properties.flatMap(property => {
    if (isShorthandPropertyAssignment(property)) {
      if (!isIdentifier(property.name)) return []
      const local = property.name.text
      const importSource = imports.get(local)
      return importSource === undefined ? [] : [{
        path: [...path, local],
        local,
        importSource,
      }]
    }
    if (!isPropertyAssignment(property)) return []
    const name = propertyName(property.name)
    return name === undefined ? [] : collectSourceReferences(property.initializer, imports, [...path, name])
  })
}

/** Печатает переносимое значение, заменяя подтверждённые импорты исходными именами. */
function renderValue(
  value: TraceValue,
  path: readonly (string | number)[],
  references: ReadonlyMap<string, SourceReference>,
  usedImports: Set<string>,
  depth = 0,
): string | null {
  const reference = references.get(JSON.stringify(path))
  if (reference !== undefined) {
    usedImports.add(reference.importSource)
    return reference.local
  }
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value)
  }
  const indentation = "  ".repeat(depth)
  const childIndentation = "  ".repeat(depth + 1)
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    const items = value.map((item, index) => renderValue(item, [...path, index], references, usedImports, depth + 1))
    if (items.some(item => item === null)) return null
    return `[\n${items.map(item => `${childIndentation}${item}`).join(",\n")}\n${indentation}]`
  }
  if (Object.hasOwn(value, "$type")) return null
  const entries = Object.entries(value)
  if (entries.length === 0) return "{}"
  const fields = entries.map(([key, item]) => {
    const rendered = renderValue(item, [...path, key], references, usedImports, depth + 1)
    return rendered === null ? null : `${JSON.stringify(key)}: ${rendered}`
  })
  if (fields.some(field => field === null)) return null
  return `{\n${fields.map(field => `${childIndentation}${field}`).join(",\n")}\n${indentation}}`
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
    const imports = new Map<string, string>()
    const describes = new Set<string>()
    for (const statement of file.statements) {
      if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue
      const clause = statement.importClause
      if (!clause || clause.phaseModifier === SyntaxKind.TypeKeyword) continue
      const named = clause.namedBindings
      const specifier = statement.moduleSpecifier.text
      if (clause.name) imports.set(clause.name.text, `import ${clause.name.text} from ${JSON.stringify(specifier)}`)
      if (named && isNamedImports(named)) {
        for (const binding of named.elements) {
          if (binding.isTypeOnly) continue
          const exported = binding.propertyName?.text ?? binding.name.text
          imports.set(binding.name.text,
            `import {${exported}${exported === binding.name.text ? "" : ` as ${binding.name.text}`}} from ${JSON.stringify(specifier)}`)
        }
      }
      if (!named || !isNamedImports(named)) continue
      if (specifier === "bun:test") {
        for (const binding of named.elements) {
          if (!binding.isTypeOnly && (binding.propertyName?.text ?? binding.name.text) === "describe") {
            describes.add(binding.name.text)
          }
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
    const calls: ({local: string} & CallSite)[] = []
    const referencesByVariant: SourceReference[][] = []
    let groups = 0
    const visit = (node: Node, propsName: string): void => {
      if (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node)) return
      if (isCallExpression(node) && isIdentifier(node.expression) && bindings.has(node.expression.text)) {
        const before = text.slice(0, node.getStart(file))
        calls.push({
          local: node.expression.text,
          line: before.split("\n").length,
          column: before.length - before.lastIndexOf("\n"),
          propsArgumentIndexes: node.arguments.flatMap((argument, index) =>
            isIdentifier(argument) && argument.text === propsName ? [index] : []),
        })
      }
      node.forEachChild(child => visit(child, propsName))
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
      const parameter = callback.parameters[0]?.name
      if (!parameter || !isObjectBindingPattern(parameter)) continue
      const props = parameter.elements.find(element => {
        if (!element || !isBindingElement(element) || !element.name || !isIdentifier(element.name)) return false
        if (element.propertyName === undefined) return element.name.text === "props"
        return isIdentifier(element.propertyName) && element.propertyName.text === "props"
      })
      if (!props || !isBindingElement(props) || !props.name || !isIdentifier(props.name)) continue
      const propsName = props.name.text
      const table = unwrapExpression(each.arguments[0]!)
      if (isArrayLiteralExpression(table)) {
        for (const row of table.elements) {
          const literal = unwrapExpression(row)
          if (!isObjectLiteralExpression(literal)) {
            referencesByVariant.push([])
            continue
          }
          const field = literal.properties.find(property => isPropertyAssignment(property)
            && propertyName(property.name) === "props")
          referencesByVariant.push(field && isPropertyAssignment(field)
            ? collectSourceReferences(field.initializer, imports)
            : [])
        }
      }
      groups++
      callback.body.forEachChild(child => visit(child, propsName))
    }
    const local = calls[0]?.local
    if (groups !== 1 || !local || calls.some(call => call.local !== local)) return null
    const binding = bindings.get(local)!
    return {
      path,
      module,
      ...binding,
      local,
      locations: calls.map(({line, column, propsArgumentIndexes}) => ({line, column, propsArgumentIndexes})),
      referencesByVariant,
    }
  } finally {
    await api.close()
  }
}

/** Связывает исходный вызов с наблюдёнными аргументами и исходом того же запуска. */
export function createFunctionPreview(
  descriptor: FunctionDescriptor,
  execution: ScenarioExecution,
  overriddenProps: readonly string[] = [],
  variantOffset = 0,
): Extract<ScenarioPreview, {kind: "function"}> | undefined {
  const groups = execution.groups.filter(group => group.parentId === null)
  const variants: Extract<ScenarioPreview, {kind: "function"}>["variants"][number][] = []
  for (const [variantIndex, group] of groups.entries()) {
    const observed = execution.calls.filter(call => call.groupId === group.id && call.test === null
      && call.module === descriptor.module && call.name === descriptor.export
      && call.location?.path === descriptor.path
      && descriptor.locations.some(location => location.line === call.location!.line && location.column === call.location!.column))
    const usedImports = new Set<string>()
    const calls: Extract<ScenarioPreview, {kind: "function"}>["variants"][number]["calls"][number][] = []
    for (const call of observed) {
      const location = descriptor.locations.find(item => item.line === call.location?.line
        && item.column === call.location.column)
      const references = new Map<string, SourceReference>()
      for (const index of location?.propsArgumentIndexes ?? []) {
        for (const reference of descriptor.referencesByVariant[variantIndex + variantOffset] ?? []) {
          if (typeof reference.path[0] === "string" && overriddenProps.includes(reference.path[0])) continue
          const located = {...reference, path: [index, ...reference.path]}
          references.set(JSON.stringify(located.path), located)
        }
      }
      const args = call.args.map((value, index) => renderValue(value, [index], references, usedImports))
      if (args.some(value => value === null)) return undefined
      calls.push({
        id: call.id,
        source: `${call.outcome.type === "resolve" || call.outcome.type === "reject" ? "await " : ""}${descriptor.local}(${args.join(", ")})`,
        outcome: structuredClone(call.outcome),
      })
    }
    const imports = [...new Set([descriptor.importSource, ...usedImports])]
    const parameters = group.parameters
    const rawProps = parameters !== null && typeof parameters === "object" && !Array.isArray(parameters)
      ? (parameters as Record<string, TraceValue>).props : undefined
    const props = rawProps !== null && typeof rawProps === "object" && !Array.isArray(rawProps)
      ? Object.fromEntries(Object.entries(rawProps as Record<string, TraceValue>).filter(([, value]) => isPortable(value))) : {}
    variants.push({
      id: String(group.id),
      title: group.label,
      props,
      source: `${imports.join("\n")}\n\n${calls.map(call => call.source).join("\n\n")}`,
      points: previewPoints(execution, group.id),
      calls,
    })
  }
  return variants.some(variant => variant.calls.length > 0) ? {kind: "function", variants} : undefined
}
