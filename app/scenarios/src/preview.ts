/**
Соединяет статическое описание компонента или функции с данными выполненного сценария.

@packageDocumentation
*/
import {dirname, resolve} from "node:path"
import {API, NodeBuilderFlags} from "typescript/unstable/async"
import {SyntaxKind} from "typescript/unstable/ast"
import type {Node} from "typescript/unstable/ast"
import {
  isArrowFunction,
  isBlock,
  isBindingElement,
  isExpressionStatement,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isJsxElement,
  isJsxFragment,
  isJsxExpression,
  isJsxSelfClosingElement,
  isNamedImports,
  isObjectBindingPattern,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import type {ReadScenarioInput} from "../contract/input"
import type {ScenarioExecution, ScenarioPreview, TraceValue} from "./types"
import {createFunctionPreview, inspectFunctionScenario} from "./function-preview"
import {readJsxProps, jsxPropImport, type JsxProp} from "./preview-jsx"
import {validateScenario} from "@archetypes/specs/scenarios/validation"
import {readScenarioSource} from "./read-source"
import {readPreviewSetup} from "./preview-setup"
import {isPortable, previewPoints} from "./preview-values"

/** Runtime import компонента в исходнике сценария. */
interface ComponentBinding {
  readonly module: string
  readonly export: string
}

/** Диапазон прямого обращения к одному полю props внутри JSX. */
interface Replacement {
  readonly start: number
  readonly end: number
  readonly property?: string
  readonly child?: boolean
}

/** Проверенная статическая связь сценария и JSX публичного компонента. */
interface PreviewDescriptor {
  readonly scenarioPath: string
  readonly renderLines: readonly number[]
  readonly tables: readonly {line: number; jsxProps: readonly Readonly<Record<string, JsxProp | null>>[]}[]
  readonly componentPath: string
  readonly componentExport: string
  readonly moduleSource: string
  readonly presentation: {
    readonly componentImport: string
    readonly source: string
    readonly replacements: readonly Replacement[]
  }
}

/** Возвращает координату строки узла с единицы. */
function lineAt(text: string, position: number): number {
  return text.slice(0, position).split("\n").length
}

/** Убирает скобки вокруг возвращённого JSX. */
function unwrap(node: Node): Node {
  let current = node
  while (isParenthesizedExpression(current)) current = current.expression
  return current
}

/** Находит импорт runtime-значения по локальному имени. */
function importedBinding(statement: Node, localName: string): ComponentBinding | null {
  if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) return null
  const clause = statement.importClause
  if (!clause || clause.phaseModifier === SyntaxKind.TypeKeyword) return null
  if (clause.name?.text === localName) return {module: statement.moduleSpecifier.text, export: "default"}
  const named = clause.namedBindings
  if (!named || !isNamedImports(named)) return null
  const binding = named.elements.find(item => !item.isTypeOnly && item.name.text === localName)
  return binding ? {module: statement.moduleSpecifier.text, export: binding.propertyName?.text ?? binding.name.text} : null
}

/** Строит самостоятельный import компонента для редактора исходника. */
function componentImport(statement: Node, localName: string): string | null {
  const binding = importedBinding(statement, localName)
  if (!binding) return null
  const module = JSON.stringify(binding.module)
  if (binding.export === "default") return `import ${localName} from ${module}`
  return binding.export === localName
    ? `import {${localName}} from ${module}`
    : `import {${binding.export} as ${localName}} from ${module}`
}

/** Находит JSX непосредственно в единственном аргументе render сценария. */
async function inspectScenario(pathInput: string): Promise<PreviewDescriptor | null> {
  const scenarioPath = resolve(pathInput)
  if (!scenarioPath.endsWith(".tsx")) return null
  const text = await Bun.file(scenarioPath).text()
  if (!/\.render(?:Component)?\s*\(/u.test(text)) return null
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [scenarioPath]})
    const project = await snapshot.getDefaultProjectForFile(scenarioPath)
    const file = await project?.program.getSourceFile(scenarioPath)
    if (!file) return null
    const imports = new Map<string, ComponentBinding>()
    const importNodes: Node[] = []
    const describeBindings = new Set<string>()
    for (const statement of file.statements) {
      if (!isImportDeclaration(statement) || !statement.importClause) continue
      if (isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "bun:test") {
        const named = statement.importClause.namedBindings
        if (named && isNamedImports(named)) {
          for (const binding of named.elements) {
            if (!binding.isTypeOnly && (binding.propertyName?.text ?? binding.name.text) === "describe") {
              describeBindings.add(binding.name.text)
            }
          }
        }
      }
      const names = [statement.importClause.name,
        ...(statement.importClause.namedBindings && isNamedImports(statement.importClause.namedBindings)
          ? statement.importClause.namedBindings.elements.map(item => item.name) : [])]
      for (const name of names) {
        if (!name) continue
        const binding = importedBinding(statement, name.text)
        if (binding) {
          imports.set(name.text, binding)
          importNodes.push(name)
        }
      }
    }
    const renders: {binding: ComponentBinding, line: number, jsx: Node, propsName: string, propsNode: Node, scope: readonly Node[]}[] = []
    const visit = (node: Node, propsName: string, propsNode: Node, scope: readonly Node[]): void => {
      if (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node)) return
      if (isCallExpression(node) && isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "render" && node.arguments.length === 1) {
        const jsx = unwrap(node.arguments[0]!)
        if (isJsxElement(jsx) || isJsxSelfClosingElement(jsx)) {
          const opening = isJsxElement(jsx) ? jsx.openingElement : jsx
          const binding = isIdentifier(opening.tagName) ? imports.get(opening.tagName.text) : undefined
          if (binding) renders.push({binding, line: lineAt(text, node.getStart(file)), jsx, propsName, propsNode, scope})
        }
      }
      node.forEachChild(child => visit(child, propsName, propsNode, scope))
    }
    const tables: PreviewDescriptor["tables"][number][] = []
    const scan = (statements: readonly Node[]): void => {
      for (const statement of statements) {
        if (!isExpressionStatement(statement) || !isCallExpression(statement.expression)) continue
        const registration = statement.expression
        const callback = registration.arguments.find(argument => isArrowFunction(argument) || isFunctionExpression(argument))
        if (!callback || (!isArrowFunction(callback) && !isFunctionExpression(callback)) || !isBlock(callback.body)) continue
        const plain = isIdentifier(registration.expression) && describeBindings.has(registration.expression.text)
        const each = isCallExpression(registration.expression)
          && isPropertyAccessExpression(registration.expression.expression)
          && registration.expression.expression.name.text === "each"
          && isIdentifier(registration.expression.expression.expression)
          && describeBindings.has(registration.expression.expression.expression.text)
        if (!plain && !each) continue
        if (each && isCallExpression(registration.expression)) {
          const table = registration.expression.arguments[0]
          if (table) tables.push({line: lineAt(text, registration.getStart(file)), jsxProps: readJsxProps(table, file, imports)})
          const parameter = callback.parameters[0]?.name
          if (parameter && isObjectBindingPattern(parameter)) {
            const props = parameter.elements.find(element => {
              if (!isBindingElement(element) || !element.name || !isIdentifier(element.name)) return false
              const name = element.propertyName ?? element.name
              return isIdentifier(name) && name.text === "props"
            })
            if (props && isBindingElement(props) && props.name && isIdentifier(props.name)) {
              const propsNode = props.name
              const scope = [...callback.body.statements]
              callback.body.forEachChild(child => visit(child, propsNode.text, propsNode, scope))
            }
          }
        }
        scan([...callback.body.statements])
      }
    }
    scan([...file.statements])
    if (tables.length === 0 || renders.length === 0) return null
    const render = renders[0]!
    let componentPath: string
    try {
      componentPath = Bun.resolveSync(render.binding.module, dirname(scenarioPath))
      if (renders.some(item => item.binding.export !== render.binding.export || Bun.resolveSync(item.binding.module, dirname(scenarioPath)) !== componentPath)) return null
    } catch { return null }
    const jsx = render.jsx
    const setup = await readPreviewSetup(file, jsx, render.scope, project!.checker)
    const propsType = await project!.checker.getTypeAtLocation(render.propsNode)
    if (!propsType || propsType.isErrorType()) throw new Error(`${scenarioPath}: TypeScript не определил тип props сценария`)
    const propsTypeSource = await project!.checker.typeToString(propsType, undefined, NodeBuilderFlags.NoTruncation | NodeBuilderFlags.UseFullyQualifiedType)
    const used = new Set<string>()
    const importReferences: Node[] = []
    const replacements: Replacement[] = []
    const replacementNodes: Node[] = []
    let offset = 0
    const visitProps = (node: Node, parent?: Node): void => {
      if (isIdentifier(node) && imports.has(node.text)) importReferences.push(node)
      if (parent && isJsxElement(parent) && isJsxExpression(node) && node.expression
        && isPropertyAccessExpression(node.expression) && isIdentifier(node.expression.expression)
        && node.expression.expression.text === render.propsName) {
        replacementNodes.push(node.expression.expression)
        replacements.push({start: node.getStart(file) + offset, end: node.end + offset, property: node.expression.name.text, child: true})
        return
      }
      if (isPropertyAccessExpression(node) && isIdentifier(node.expression) && node.expression.text === render.propsName) {
        replacementNodes.push(node.expression)
        replacements.push({start: node.getStart(file) + offset, end: node.end + offset, property: node.name.text})
        return
      }
      if (isIdentifier(node) && node.text === render.propsName) {
        replacementNodes.push(node)
        replacements.push({start: node.getStart(file) + offset, end: node.end + offset})
        return
      }
      node.forEachChild(child => visitProps(child, node))
    }
    let source = ""
    for (const fragment of [...setup, jsx]) {
      if (source) source += fragment === jsx ? "\n\n;" : "\n"
      offset = source.length - fragment.getStart(file)
      visitProps(fragment)
      source += text.slice(fragment.getStart(file), fragment.end)
    }
    const propsSymbols = await project!.checker.getSymbolAtLocation([render.propsNode, ...replacementNodes])
    const boundReplacements = replacements.filter((_, index) => propsSymbols[index + 1]?.id === propsSymbols[0]?.id)
    const importSymbols = await project!.checker.getSymbolAtLocation([...importNodes, ...importReferences])
    const importNames = new Map(importSymbols.slice(0, importNodes.length).flatMap((symbol, index) => {
      const node = importNodes[index]!
      return symbol && isIdentifier(node) ? [[symbol.id, node.text] as const] : []
    }))
    for (const symbol of importSymbols.slice(importNodes.length)) {
      const name = symbol && importNames.get(symbol.id)
      if (name) used.add(name)
    }
    if (!isJsxElement(jsx) && !isJsxSelfClosingElement(jsx)) return null
    const name = isJsxElement(jsx) ? jsx.openingElement.tagName : jsx.tagName
    if (!isIdentifier(name)) return null
    const importLines = [...used].flatMap(local => file.statements.map(statement => componentImport(statement, local)).filter((line): line is string => line !== null))
    const importSource = importLines.join("\n")
    const absoluteImports = [...used].flatMap(local => {
      const binding = imports.get(local)!
      if (binding.module === "bun:test" && binding.export === "mock") return []
      const line = file.statements.map(statement => componentImport(statement, local)).find(Boolean)
      return line ? [line.replace(JSON.stringify(binding.module), JSON.stringify(Bun.resolveSync(binding.module, dirname(scenarioPath))))] : []
    }).join("\n")
    const browserSetup: string[] = []
    for (const statement of setup) {
      const mocks: Node[] = []
      const visitMock = (node: Node): void => {
        if (isCallExpression(node) && isIdentifier(node.expression)) {
          const binding = imports.get(node.expression.text)
          if (binding?.module === "bun:test" && binding.export === "mock") mocks.push(node)
        }
        node.forEachChild(visitMock)
      }
      visitMock(statement)
      let body = text.slice(statement.getStart(file), statement.end)
      for (const node of mocks.sort((a, b) => b.pos - a.pos)) {
        if (!isCallExpression(node) || !isIdentifier(node.expression)) continue
        const symbol = await project!.checker.getSymbolAtLocation(node.expression)
        if (!symbol || importNames.get(symbol.id) !== node.expression.text) continue
        // Журнал native mock принадлежит Bun. В браузер переносится только поведение callback.
        const implementation = node.arguments[0]
        const value = implementation ? text.slice(implementation.getStart(file), implementation.end) : "() => undefined"
        body = body.slice(0, node.getStart(file) - statement.getStart(file)) + value + body.slice(node.end - statement.getStart(file))
      }
      browserSetup.push(body)
    }
    return {
      componentPath: scenarioPath, componentExport: "ScenarioComponent",
      moduleSource: `${absoluteImports}\n\nexport function ScenarioComponent(${render.propsName}: ${propsTypeSource}) {\n${browserSetup.join("\n")}\n  return ${text.slice(jsx.getStart(file), jsx.end)}\n}\n`,
      scenarioPath, renderLines: renders.map(item => item.line), tables,
      presentation: {componentImport: importSource, source, replacements: boundReplacements},
    }
  } finally {
    await api.close()
  }
}

/** Убирает отступ исходной таблицы, сохраняя взаимные отступы внутри JSX. */
function formatJsxChild(source: string): string {
  const lines = source.split("\n")
  const rest = lines.slice(1).filter(line => line.trim().length > 0)
  const margin = rest.length ? Math.min(...rest.map(line => /^\s*/u.exec(line)![0].length)) : 0
  return [lines[0], ...lines.slice(1).map(line => line.slice(margin))].join("\n")
}

/** Подставляет фактические props в JSX сценария; отсутствующее поле сохраняет обычное значение undefined. */
function renderSource(descriptor: PreviewDescriptor, props: Readonly<Record<string, TraceValue>>, jsxProps: Readonly<Record<string, JsxProp>>): string | null {
  const presentation = descriptor.presentation
  const imports = new Set([presentation.componentImport])
  let jsx = presentation.source
  for (const replacement of [...presentation.replacements].sort((left, right) => right.start - left.start)) {
    const authored = replacement.property === undefined ? undefined : jsxProps[replacement.property]
    const present = replacement.property === undefined || Object.hasOwn(props, replacement.property)
    const value = replacement.property === undefined ? props : props[replacement.property]!
    if (!authored && present && !isPortable(value)) return null
    for (const binding of authored?.imports ?? []) imports.add(jsxPropImport(binding))
    const start = replacement.start
    const end = replacement.end
    const lineStart = jsx.lastIndexOf("\n", start - 1) + 1
    const indent = /^\s*/u.exec(jsx.slice(lineStart, start))?.[0] ?? ""
    let literal = authored ? formatJsxChild(authored.source) : present ? JSON.stringify(value, null, 2) : "undefined"
    if (replacement.property === undefined && Object.keys(jsxProps).length) {
      for (const item of Object.values(jsxProps)) for (const binding of item.imports) imports.add(jsxPropImport(binding))
      literal = `{${[...Object.entries(props).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`),
        ...Object.entries(jsxProps).map(([key, value]) => `${JSON.stringify(key)}: ${formatJsxChild(value.source)}`)].join(", ")}}`
    }
    const expression = replacement.child && !authored ? `{${literal}}` : literal
    const source = expression.replaceAll("\n", `\n${indent}`)
    jsx = jsx.slice(0, start) + source + jsx.slice(end)
  }
  return `${[...imports].join("\n")}\n\n${jsx}`
}

/**
Проверяет поддержку preview статически и не исполняет scenario.spec.

@param input - Путь к сценарию компонента или функции.
@returns `true` для JSX компонента внутри render или прямого вызова функции.
*/
export async function supportsScenarioPreview(input: Pick<ReadScenarioInput, "path">): Promise<boolean> {
  const source = await readScenarioSource(input.path)
  const check = validateScenario(source).checks.find(check => ["render-jsx", "single-invocation", "general-particular"].includes(check.rule) && check.status === "failed")
  if (check) throw new Error(check.issues.map(issue => `${issue.location?.path ?? source.path}:${issue.location?.line ?? 1}: ${issue.message}`).join("\n"))
  return await inspectScenario(input.path) !== null || await inspectFunctionScenario(input.path) !== null
}

/** Собирает представление из статической связи и снимков того же запуска; повторных вызовов нет. */
export async function createScenarioPreview(
  path: string,
  execution: ScenarioExecution,
  overriddenProps: readonly string[] = [],
  variantOffset = 0,
  selectedPath?: readonly number[],
): Promise<ScenarioPreview | undefined> {
  const descriptor = await inspectScenario(path)
  if (!descriptor) {
    const functionDescriptor = await inspectFunctionScenario(path)
    return functionDescriptor ? createFunctionPreview(functionDescriptor, execution, overriddenProps, variantOffset) : undefined
  }
  const calls = execution.calls.filter(call => call.groupId !== null
    && call.test === null
    && call.name.endsWith(".render")
    && call.location?.path === descriptor.scenarioPath
    && descriptor.renderLines.includes(call.location.line))
  if (calls.length === 0) return undefined
  const variants: Extract<ScenarioPreview, {kind: "component"}>["variants"][number][] = []
  const seen = new Set<number>()
  for (const call of calls) {
    const group = execution.groups.find(item => item.id === call.groupId)
    if (!group || group.parameters === null || seen.has(group.id)) return undefined
    const ancestry = [group]
    let parent = group.parentId
    while (parent !== null) {
      const ancestor = execution.groups.find(item => item.id === parent)
      if (!ancestor) return undefined
      ancestry.unshift(ancestor)
      parent = ancestor.parentId
    }
    const parameterized = ancestry.filter(item => item.parameters !== null)
    const selection = parameterized.map((item, index) => selectedPath?.[index] ?? execution.groups
      .filter(sibling => sibling.parentId === item.parentId && sibling.location.path === item.location.path && sibling.location.line === item.location.line)
      .findIndex(sibling => sibling.id === item.id))
    const jsxProps: Record<string, JsxProp> = {}
    parameterized.forEach((item, index) => {
      const table = descriptor.tables.find(table => table.line === item.location.line)
      for (const [key, value] of Object.entries(table?.jsxProps[selection[index]!] ?? {})) {
        if (value) jsxProps[key] = value
        else delete jsxProps[key]
      }
    })
    for (const key of overriddenProps) delete jsxProps[key]
    const captured = group.parameters && typeof group.parameters === "object" && !Array.isArray(group.parameters)
      ? (group.parameters as Readonly<Record<string, TraceValue>>).props : undefined
    const props = captured && !Array.isArray(captured) && typeof captured === "object"
      ? Object.fromEntries(Object.entries(captured).filter(([key]) => !Object.hasOwn(jsxProps, key))) : captured
    if (!props || Array.isArray(props) || typeof props !== "object" || !isPortable(props)) return undefined
    const source = renderSource(descriptor, props as Readonly<Record<string, TraceValue>>, jsxProps)
    if (!source) return undefined
    seen.add(group.id)
    const points = previewPoints(execution, group.id)
    variants.push({
      id: String(group.id),
      title: ancestry.map(item => item.label).join(" / "),
      selection,
      ...(ancestry.length > 1 ? {path: ancestry.map(item => item.label)} : {}),
      props: props as Readonly<Record<string, unknown>>,
      source,
      ...(Object.keys(jsxProps).length ? {jsxProps} : {}),
      points,
    })
  }
  return {
    kind: "component",
    module: {path: descriptor.componentPath, export: descriptor.componentExport, source: descriptor.moduleSource},
    variants,
  }
}
