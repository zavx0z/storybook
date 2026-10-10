import type {Node, SourceFile} from "typescript/unstable/ast"
import {
  isArrayLiteralExpression, isAsExpression, isConditionalExpression, isJsxAttribute,
  isJsxElement, isJsxExpression, isJsxFragment, isJsxSelfClosingElement,
  isParenthesizedExpression, isSatisfiesExpression,
} from "typescript/unstable/ast/is"

/** Снимает назначение только текущему получателю content; вложенный JSX владеет своими слотами. */
export function slotContentSource(root: Node, file: SourceFile): string {
  const start = root.getStart(file)
  const removals: {start: number; end: number}[] = []
  const visit = (node: Node): void => {
    if (isAsExpression(node) || isSatisfiesExpression(node) || isParenthesizedExpression(node)) {
      visit(node.expression)
    } else if (isJsxFragment(node)) {
      node.children.forEach(visit)
    } else if (isJsxExpression(node)) {
      if (node.expression) visit(node.expression)
    } else if (isConditionalExpression(node)) {
      visit(node.whenTrue)
      visit(node.whenFalse)
    } else if (isArrayLiteralExpression(node)) {
      node.elements.forEach(visit)
    } else if (isJsxElement(node) || isJsxSelfClosingElement(node)) {
      const opening = isJsxElement(node) ? node.openingElement : node
      for (const attribute of opening.attributes.properties) {
        if (isJsxAttribute(attribute) && attribute.name.getText(file) === "slot") {
          removals.push({start: attribute.getFullStart(), end: attribute.end})
        }
      }
      // Дети этого элемента адресуются ему, а не внешнему получателю content.
    }
  }
  visit(root)
  let source = file.text.slice(start, root.end)
  for (const removal of removals.sort((left, right) => right.start - left.start)) {
    source = source.slice(0, removal.start - start) + source.slice(removal.end - start)
  }
  return source
}
