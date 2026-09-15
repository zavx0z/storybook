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
}

/** Проверенная статическая связь scenario, fixture и JSX компонента. */
interface PreviewDescriptor {
  readonly scenarioPath: string
  readonly renderLine: number
  readonly fixturePath: string
  readonly fixtureExport: string
  readonly componentImport: string
  readonly jsx: string
  readonly jsxStart: number
  readonly replacements: readonly Replacement[]
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

/** Читает поддержанный export fixture и прямые обращения `props.<field>` внутри JSX. */
async function readFixture(path: string, exportName: string): Promise<Omit<PreviewDescriptor, "scenarioPath" | "renderLine"> | null> {
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
    const statement = statements[0]
    if (statements.length !== 1 || !statement || !isReturnStatement(statement) || !statement.expression) return null
    const returned = unwrap(statement.expression)
    if (isJsxElement(returned) || !isJsxSelfClosingElement(returned) || !isIdentifier(returned.tagName)) return null
    const componentName = returned.tagName.text
    const importSource = file.statements.map(statement => componentImport(statement, componentName)).find(Boolean)
    if (!importSource) return null
    const replacements: Replacement[] = []
    for (const attribute of returned.attributes.properties) {
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
    if (replacements.length === 0) return null
    const jsxStart = returned.getStart(file)
    return {
      fixturePath: path,
      fixtureExport: exportName,
      componentImport: importSource,
      jsx: text.slice(jsxStart, returned.end),
      jsxStart,
      replacements,
    }
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
    let variants = 0
    for (const statement of file.statements) {
      if (!isExpressionStatement(statement) || !isCallExpression(statement.expression)) continue
      const registration = statement.expression
      if (!isCallExpression(registration.expression)
        || !isPropertyAccessExpression(registration.expression.expression)
        || registration.expression.expression.name.text !== "each"
        || !isIdentifier(registration.expression.expression.expression)
        || !describeBindings.has(registration.expression.expression.expression.text)) continue
      const callback = registration.arguments.find(argument => isArrowFunction(argument) || isFunctionExpression(argument))
      if (!callback || (!isArrowFunction(callback) && !isFunctionExpression(callback)) || !isBlock(callback.body)) continue
      const parameter = callback.parameters[0]?.name
      if (!parameter || !isObjectBindingPattern(parameter)) continue
      const props = parameter.elements.find(element => {
        if (!element || !isBindingElement(element) || !element.name || !isIdentifier(element.name)) return false
        const name = element.propertyName ?? element.name
        return !!name && isIdentifier(name) && name.text === "props"
      })
      if (!props || !isBindingElement(props) || !props.name || !isIdentifier(props.name)) continue
      const propsName = props.name.text
      variants++
      callback.body.forEachChild(child => visit(child, propsName))
    }
    if (variants !== 1 || renders.length !== 1) return null
    const render = renders[0]!
    let fixturePath: string
    try {
      fixturePath = Bun.resolveSync(render.binding.module, dirname(scenarioPath))
    } catch {
      return null
    }
    const fixture = await readFixture(fixturePath, render.binding.export)
    return fixture ? {...fixture, scenarioPath, renderLine: render.line} : null
  } finally {
    await api.close()
  }
}

/** Подставляет фактические props в JSX fixture, не вычисляя выражения исходника. */
function renderSource(descriptor: PreviewDescriptor, props: Readonly<Record<string, TraceValue>>): string | null {
  let jsx = descriptor.jsx
  for (const replacement of [...descriptor.replacements].sort((left, right) => right.start - left.start)) {
    if (!Object.hasOwn(props, replacement.property)) return null
    const value = props[replacement.property]!
    if (!isPortable(value)) return null
    const start = replacement.start - descriptor.jsxStart
    const end = replacement.end - descriptor.jsxStart
    const lineStart = jsx.lastIndexOf("\n", start - 1) + 1
    const indent = /^\s*/u.exec(jsx.slice(lineStart, start))?.[0] ?? ""
    const source = JSON.stringify(value, null, 2).replaceAll("\n", `\n${indent}`)
    jsx = jsx.slice(0, start) + source + jsx.slice(end)
  }
  return `${descriptor.componentImport}\n\n${jsx}`
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
export async function createScenarioPreview(path: string, execution: ScenarioExecution): Promise<ScenarioPreview | undefined> {
  const descriptor = await inspectScenario(path)
  if (!descriptor) {
    const functionDescriptor = await inspectFunctionScenario(path)
    return functionDescriptor ? createFunctionPreview(functionDescriptor, execution) : undefined
  }
  const calls = execution.calls.filter(call => call.groupId !== null
    && call.test === null
    && call.name.endsWith(".render")
    && call.location?.path === descriptor.scenarioPath
    && call.location.line === descriptor.renderLine)
  const topLevel = execution.groups.filter(group => group.parentId === null)
  if (calls.length === 0 || calls.length !== topLevel.length) return undefined
  const variants: Extract<ScenarioPreview, {kind: "component"}>["variants"][number][] = []
  const seen = new Set<number>()
  for (const call of calls) {
    const group = execution.groups.find(item => item.id === call.groupId)
    const props = call.args[1]
    if (!group || group.parentId !== null || seen.has(group.id)
      || !props || Array.isArray(props) || typeof props !== "object" || !isPortable(props)) return undefined
    const source = renderSource(descriptor, props as Readonly<Record<string, TraceValue>>)
    if (!source) return undefined
    seen.add(group.id)
    const points = previewPoints(execution, group.id)
    variants.push({
      id: String(group.id),
      title: group.label,
      props: props as Readonly<Record<string, unknown>>,
      source,
      points,
    })
  }
  return {
    kind: "component",
    module: {path: descriptor.fixturePath, export: descriptor.fixtureExport},
    variants,
  }
}
