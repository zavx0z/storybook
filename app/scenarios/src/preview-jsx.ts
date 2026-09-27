import {dirname} from "node:path"
import type {Node, SourceFile} from "typescript/unstable/ast"
import {
  isArrayLiteralExpression, isAsExpression, isIdentifier, isJsxElement,
  isJsxExpression, isJsxSelfClosingElement, isJsxSpreadAttribute, isObjectLiteralExpression,
  isParenthesizedExpression, isPropertyAssignment, isSatisfiesExpression, isStringLiteral,
} from "typescript/unstable/ast/is"
import type {ScenarioPreview} from "./types"

type Variant = Extract<ScenarioPreview, {kind: "component"}>["variants"][number]
export type JsxProp = NonNullable<Variant["jsxProps"]>[string]
type Binding = Readonly<{module: string; export: string}>

/** Снимает только синтаксические обёртки; авторские выражения не исполняются. */
function unwrap(node: Node): Node {
  while (isAsExpression(node) || isSatisfiesExpression(node) || isParenthesizedExpression(node)) node = node.expression
  return node
}

/** Читает явно объявленное поле литерала без spread и вычисляемых имён. */
function field(node: Node, name: string): Node | undefined {
  const value = unwrap(node)
  if (!isObjectLiteralExpression(value)) return undefined
  const property = value.properties.find(item => isPropertyAssignment(item)
    && (isIdentifier(item.name) || isStringLiteral(item.name)) && item.name.text === name)
  return property && isPropertyAssignment(property) ? property.initializer : undefined
}

/** Сохраняет JSX с импортированными компонентами и литеральными параметрами для штатной сборки. */
function jsxProp(node: Node, file: SourceFile, imports: ReadonlyMap<string, Binding>): JsxProp | null {
  const root = unwrap(node)
  if (!isJsxElement(root) && !isJsxSelfClosingElement(root)) return null
  const used = new Map<string, JsxProp["imports"][number]>()
  let supported = true
  const visit = (current: Node): void => {
    if (isJsxElement(current) || isJsxSelfClosingElement(current)) {
      const opening = isJsxElement(current) ? current.openingElement : current
      if (!isIdentifier(opening.tagName)) { supported = false; return }
      const local = opening.tagName.text
      if (/^[A-Z]/u.test(local)) {
        const binding = imports.get(local)
        if (!binding) { supported = false; return }
        try {
          used.set(local, {local, imported: binding.export, specifier: binding.module,
            path: Bun.resolveSync(binding.module, dirname(file.fileName))})
        } catch { supported = false }
      }
    }
    if (isJsxSpreadAttribute(current)) supported = false
    if (isJsxExpression(current) && current.expression) {
      const expression = unwrap(current.expression)
      if (isJsxElement(expression) || isJsxSelfClosingElement(expression)) visit(expression)
      else {
        try { JSON.parse(file.text.slice(expression.getStart(file), expression.end)) }
        catch { supported = false }
      }
      return
    }
    current.forEachChild(visit)
  }
  visit(root)
  return supported ? {source: file.text.slice(root.getStart(file), root.end), imports: [...used.values()]} : null
}

/** Строки внешней таблицы сопоставляются с результатом выполнения по исходному индексу. */
export function readJsxProps(table: Node, file: SourceFile, imports: ReadonlyMap<string, Binding>): readonly Readonly<Record<string, JsxProp>>[] {
  const value = unwrap(table)
  if (!isArrayLiteralExpression(value)) return []
  return value.elements.map(row => {
    const props = field(row, "props")
    if (!props || !isObjectLiteralExpression(unwrap(props))) return {}
    const result: Record<string, JsxProp> = {}
    const object = unwrap(props)
    if (!isObjectLiteralExpression(object)) return result
    for (const property of object.properties) {
      if (!isPropertyAssignment(property) || (!isIdentifier(property.name) && !isStringLiteral(property.name))) continue
      const value = jsxProp(property.initializer, file, imports)
      if (value) result[property.name.text] = value
    }
    return result
  })
}

/** Импорт для отображаемого исходника либо неизменяемого сборочного модуля. */
export function jsxPropImport(binding: JsxProp["imports"][number], absolute = false): string {
  const specifier = JSON.stringify(absolute ? binding.path : binding.specifier)
  return binding.imported === "default" ? `import ${binding.local} from ${specifier}`
    : `import {${binding.imported}${binding.imported === binding.local ? "" : ` as ${binding.local}`}} from ${specifier}`
}
