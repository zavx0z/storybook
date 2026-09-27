/**
Соединяет статическое описание компонента или функции с данными выполненного сценария.

@packageDocumentation
*/
import {dirname, resolve} from "node:path"
import {API} from "typescript/unstable/async"
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
  isJsxExpression,
  isJsxSelfClosingElement,
  isJsxSpreadAttribute,
  isNamedImports,
  isObjectBindingPattern,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isReturnStatement,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import type {ReadScenarioInput} from "../contract/input"
import type {ScenarioExecution, ScenarioPreview, TraceValue} from "./types"
import {createFunctionPreview, inspectFunctionScenario} from "./function-preview"
import {readJsxProps, jsxPropImport, type JsxProp} from "./preview-jsx"
import {isPortable, previewPoints} from "./preview-values"

/** Runtime import fixture в исходнике сценария. */
interface FixtureBinding {
  readonly module: string
  readonly export: string
}

/** Диапазон прямого обращения к одному полю props внутри JSX. */
interface Replacement {
  readonly start: number
  readonly end: number
  readonly property: string
  readonly child?: boolean
}

/** Проверенная статическая связь scenario, fixture и JSX компонента. */
interface PreviewDescriptor {
  readonly scenarioPath: string
  readonly renderLines: readonly number[]
  readonly tables: readonly {line: number; jsxProps: readonly Readonly<Record<string, JsxProp | null>>[]}[]
  readonly fixturePath: string
  readonly fixtureExport: string
  readonly presentation: {
    readonly componentImport: string
    readonly jsx: string
    readonly jsxStart: number
    readonly replacements: readonly Replacement[]
  } | {readonly source: string}
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
function importedBinding(statement: Node, localName: string): FixtureBinding | null {
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

/** Читает настоящую fixture; подготовка, состояние и обработчики остаются в показываемом исходнике. */
async function readFixture(path: string, exportName: string): Promise<Omit<PreviewDescriptor, "scenarioPath" | "renderLines" | "tables"> | null> {
  const text = await Bun.file(path).text()
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const file = await project?.program.getSourceFile(path)
    if (!file) return null
    const declaration = file.statements.find(statement => isFunctionDeclaration(statement)
      && statement.name?.text === exportName
      && statement.modifiers?.some(modifier => modifier.kind === SyntaxKind.ExportKeyword))
    if (!declaration || !isFunctionDeclaration(declaration) || !declaration.body || declaration.parameters.length !== 1) return null
    const parameter = declaration.parameters[0]?.name
    if (!parameter || !isIdentifier(parameter)) return null
    const statements = [...declaration.body.statements]
    const statement = statements.at(-1)
    if (!statement || !isReturnStatement(statement) || !statement.expression) return null
    const returned = unwrap(statement.expression)
    if (!isJsxElement(returned) && !isJsxSelfClosingElement(returned)) return null
    const readDirectJsx = (): Exclude<PreviewDescriptor["presentation"], {source: string}> | null => {
      if (statements.length !== 1) return null
      const opening = isJsxElement(returned) ? returned.openingElement : returned
      if (!isIdentifier(opening.tagName)) return null
      const componentName = opening.tagName.text
      const importSource = file.statements.map(statement => componentImport(statement, componentName)).find(Boolean)
      if (!importSource) return null
      const replacements: Replacement[] = []
      for (const attribute of opening.attributes.properties) {
        if (isJsxSpreadAttribute(attribute)) return null
        const initializer = attribute.initializer
        if (!initializer || isStringLiteral(initializer)) continue
        if (!isJsxExpression(initializer) || !initializer.expression
          || !isPropertyAccessExpression(initializer.expression)
          || !isIdentifier(initializer.expression.expression)
          || initializer.expression.expression.text !== parameter.text) return null
        replacements.push({
          start: initializer.expression.getStart(file),
          end: initializer.expression.end,
          property: initializer.expression.name.text,
        })
      }
      if (isJsxElement(returned)) {
        for (const child of returned.children) {
          if (child.kind === SyntaxKind.JsxText) continue
          if (!isJsxExpression(child) || !child.expression
            || !isPropertyAccessExpression(child.expression)
            || !isIdentifier(child.expression.expression)
            || child.expression.expression.text !== parameter.text) return null
          replacements.push({start: child.getStart(file), end: child.end,
            property: child.expression.name.text, child: true})
        }
      }
      if (replacements.length === 0) return null
      const jsxStart = returned.getStart(file)
      return {
        componentImport: importSource,
        jsx: text.slice(jsxStart, returned.end),
        jsxStart,
        replacements,
      }
    }
    return {fixturePath: path, fixtureExport: exportName, presentation: readDirectJsx() ?? {source: text.trim()}}
  } finally {
    await api.close()
  }
}

/** Находит единственную пару `render(Fixture, props)` и проверяет fixture тем же parser. */
async function inspectScenario(pathInput: string): Promise<PreviewDescriptor | null> {
  const scenarioPath = resolve(pathInput)
  const text = await Bun.file(scenarioPath).text()
  if (!/\.render\s*\(/u.test(text)) return null
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [scenarioPath]})
    const project = await snapshot.getDefaultProjectForFile(scenarioPath)
    const file = await project?.program.getSourceFile(scenarioPath)
    if (!file) return null
    const imports = new Map<string, FixtureBinding>()
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
      const names = [statement.importClause.name?.text,
        ...(statement.importClause.namedBindings && isNamedImports(statement.importClause.namedBindings)
          ? statement.importClause.namedBindings.elements.map(item => item.name.text) : [])]
      for (const name of names) {
        if (!name) continue
        const binding = importedBinding(statement, name)
        if (binding) imports.set(name, binding)
      }
    }
    const renders: {binding: FixtureBinding, line: number}[] = []
    const visit = (node: Node, propsName: string): void => {
      if (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node)) return
      if (isCallExpression(node) && isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "render" && node.arguments.length >= 2
        && isIdentifier(node.arguments[1]!) && node.arguments[1]!.text === propsName) {
        const fixture = node.arguments[0]
        if (fixture && isIdentifier(fixture)) {
          const binding = imports.get(fixture.text)
          if (binding) renders.push({binding, line: lineAt(text, node.getStart(file))})
        }
      }
      node.forEachChild(child => visit(child, propsName))
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
              const propsName = props.name.text
              callback.body.forEachChild(child => visit(child, propsName))
            }
          }
        }
        scan([...callback.body.statements])
      }
    }
    scan([...file.statements])
    if (tables.length === 0 || renders.length === 0) return null
    const render = renders[0]!
    let fixturePath: string
    try {
      fixturePath = Bun.resolveSync(render.binding.module, dirname(scenarioPath))
      if (renders.some(item => item.binding.export !== render.binding.export || Bun.resolveSync(item.binding.module, dirname(scenarioPath)) !== fixturePath)) return null
    } catch { return null }
    const fixture = await readFixture(fixturePath, render.binding.export)
    return fixture ? {...fixture, scenarioPath, renderLines: renders.map(item => item.line), tables} : null
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

/** Подставляет фактические props в JSX fixture; отсутствующее поле сохраняет обычное значение undefined. */
function renderSource(descriptor: PreviewDescriptor, props: Readonly<Record<string, TraceValue>>, jsxProps: Readonly<Record<string, JsxProp>>): string | null {
  const presentation = descriptor.presentation
  if ("source" in presentation) {
    const imports = new Set<string>()
    const attributes = [`  {...${JSON.stringify(props, null, 2).replaceAll("\n", "\n  ")}}`]
    for (const [name, value] of Object.entries(jsxProps)) {
      for (const binding of value.imports) imports.add(jsxPropImport(binding))
      attributes.push(`  ${name}={${formatJsxChild(value.source).replaceAll("\n", "\n  ")}}`)
    }
    return [...imports, presentation.source, `<${descriptor.fixtureExport}\n${attributes.join("\n")}\n/>`].join("\n\n")
  }
  const imports = new Set([presentation.componentImport])
  let jsx = presentation.jsx
  for (const replacement of [...presentation.replacements].sort((left, right) => right.start - left.start)) {
    const authored = jsxProps[replacement.property]
    const present = Object.hasOwn(props, replacement.property)
    const value = props[replacement.property]!
    if (!authored && present && !isPortable(value)) return null
    for (const binding of authored?.imports ?? []) imports.add(jsxPropImport(binding))
    const start = replacement.start - presentation.jsxStart
    const end = replacement.end - presentation.jsxStart
    const lineStart = jsx.lastIndexOf("\n", start - 1) + 1
    const indent = /^\s*/u.exec(jsx.slice(lineStart, start))?.[0] ?? ""
    const literal = authored ? formatJsxChild(authored.source) : present ? JSON.stringify(value, null, 2) : "undefined"
    const expression = replacement.child && !authored ? `{${literal}}` : literal
    const source = expression.replaceAll("\n", `\n${indent}`)
    jsx = jsx.slice(0, start) + source + jsx.slice(end)
  }
  return `${[...imports].join("\n")}\n\n${jsx}`
}

/**
Проверяет поддержку preview статически и не исполняет scenario.spec.

@param input - Путь к сценарию компонента или функции.
@returns `true` для поддержанной компонентной fixture или прямого вызова функции.
*/
export async function supportsScenarioPreview(input: Pick<ReadScenarioInput, "path">): Promise<boolean> {
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
    const captured = call.args[1]
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
    module: {path: descriptor.fixturePath, export: descriptor.fixtureExport},
    variants,
  }
}
