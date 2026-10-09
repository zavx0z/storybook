import type {Node} from "typescript/unstable/ast"
import {SyntaxKind} from "typescript/unstable/ast"
import {
  isArrayLiteralExpression, isArrowFunction, isBinaryExpression, isCallExpression,
  isFunctionExpression, isIdentifier, isObjectBindingPattern, isParenthesizedExpression,
  isPrefixUnaryExpression, isPropertyAccessExpression, isStringLiteral,
} from "typescript/unstable/ast/is"

/** Читает явный выбор имён из условия skipIf, связанного с параметром внешнего each. */
export function selectedVariantNames(registrar: Node, callback: Node | undefined): readonly string[] | undefined {
  if (!callback || (!isArrowFunction(callback) && !isFunctionExpression(callback))) return
  const parameter = callback.parameters[0]?.name
  let binding: string | undefined
  let row: string | undefined
  if (parameter && isObjectBindingPattern(parameter)) {
    for (const element of parameter.elements) {
      if (element.dotDotDotToken || element.initializer || !element.name || !isIdentifier(element.name)) continue
      const property = element.propertyName ?? element.name
      if ((isIdentifier(property) || isStringLiteral(property)) && property.text === "name") binding = element.name.text
    }
  } else if (parameter && isIdentifier(parameter)) row = parameter.text
  if (!binding && !row) return

  const unwrap = (node: Node): Node => isParenthesizedExpression(node) ? unwrap(node.expression) : node
  const isName = (value: Node): boolean => {
    const node = unwrap(value)
    return isIdentifier(node) && node.text === binding
      || isPropertyAccessExpression(node) && isIdentifier(node.expression)
        && node.expression.text === row && node.name.text === "name"
  }
  const literal = (value: Node): string | undefined => {
    const node = unwrap(value)
    return isStringLiteral(node) && node.text.trim().length > 0 ? node.text : undefined
  }
  const select = (value: Node): readonly string[] | undefined => {
    const node = unwrap(value)
    if (isBinaryExpression(node)) {
      if (node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken) {
        const left = select(node.left), right = select(node.right)
        return left && right ? [...left, ...right] : undefined
      }
      if (node.operatorToken.kind !== SyntaxKind.ExclamationEqualsEqualsToken) return
      const name = isName(node.left) ? literal(node.right) : isName(node.right) ? literal(node.left) : undefined
      return name === undefined ? undefined : [name]
    }
    if (!isPrefixUnaryExpression(node) || node.operator !== SyntaxKind.ExclamationToken) return
    const call = unwrap(node.operand)
    if (!isCallExpression(call) || call.arguments.length !== 1 || !isName(call.arguments[0]!)) return
    const method = call.expression
    if (!isPropertyAccessExpression(method) || method.name.text !== "includes") return
    const values = unwrap(method.expression)
    if (!isArrayLiteralExpression(values) || values.elements.length === 0) return
    const names = values.elements.map(literal)
    return names.every((name): name is string => name !== undefined) ? names : undefined
  }
  let node = registrar
  while (isCallExpression(node) || isPropertyAccessExpression(node)) {
    if (isCallExpression(node) && isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "skipIf") {
      return node.arguments.length === 1 ? select(node.arguments[0]!) : undefined
    }
    node = node.expression
  }
}
