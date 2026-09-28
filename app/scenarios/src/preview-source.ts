import type {Project} from "typescript/unstable/async"
import {NodeFlags} from "typescript/unstable/ast"
import type {Node, SourceFile, VariableStatement} from "typescript/unstable/ast"
import {
  isArrowFunction, isBinaryExpression, isConditionalExpression, isFunctionExpression, isIdentifier, isJsxElement, isJsxExpression, isJsxText, isObjectLiteralExpression,
  isPropertyAccessExpression, isPropertyAssignment, isSpreadAssignment, isStringLiteral,
} from "typescript/unstable/ast/is"

/** Место подстановки данных выбранного варианта в показываемом JSX. */
export interface PreviewReplacement {
  readonly start: number
  readonly end: number
  readonly property?: string
  readonly child?: boolean
}

/**
Раскрывает поля подготовленного объекта прямо в JSX по символам TypeScript.
Общие ссылки сохраняют объявления, чтобы пример не создавал повторные callback.
Отступ внешнего render снимается с кода с сохранением вложенности и текста литералов.
Исполняемый модуль использует исходную подготовку; здесь строится только его показ.
*/
export async function readPreviewSource(file: SourceFile, jsx: Node, setup: readonly VariableStatement[], props: Node, checker: Project["checker"]) {
  const identifiers: Node[] = [props]
  const parents = new Map<Node, Node>()
  const collect = (node: Node): void => {
    if (isIdentifier(node)) identifiers.push(node)
    node.forEachChild(child => { parents.set(child, node); collect(child) })
  }
  for (const node of [...setup, jsx]) collect(node)
  const symbols = await checker.getSymbolAtLocation(identifiers)
  const ids = new Map(identifiers.map((node, index) => [node, symbols[index]?.id]))
  const propsId = symbols[0]?.id
  const declarations = new Map(setup.flatMap(statement => statement.declarationList.declarations.flatMap(declaration => {
    const id = ids.get(declaration.name)
    return id === undefined ? [] : [[id, {statement, declaration}] as const]
  })))
  const objects = new Set([...declarations].flatMap(([id, {statement, declaration}]) =>
    statement.declarationList.flags & NodeFlags.Const && declaration.initializer && isObjectLiteralExpression(declaration.initializer)
      ? [id] : []))
  // Раскрываются только однократные прямые чтения полей. Общая identity остаётся в объявлении.
  for (const id of objects) {
    const fields = new Set<string>()
    for (const node of identifiers) {
      if (ids.get(node) !== id || node === declarations.get(id)!.declaration.name) continue
      const parent = parents.get(node)
      if (!parent || !isPropertyAccessExpression(parent) || parent.expression !== node || fields.has(parent.name.text)) {
        objects.delete(id)
        break
      }
      let ancestor = parents.get(parent)
      while (ancestor) {
        if (isArrowFunction(ancestor) || isFunctionExpression(ancestor)) objects.delete(id)
        ancestor = parents.get(ancestor)
      }
      fields.add(parent.name.text)
    }
  }
  type Value = {node: Node; property?: string}
  const property = (node: Node, name: string): Value | undefined => {
    if (ids.get(node) === propsId) return {node, property: name}
    const id = ids.get(node)
    const object = id !== undefined && objects.has(id) ? declarations.get(id)?.declaration.initializer : node
    if (!object || !isObjectLiteralExpression(object)) return undefined
    for (const member of [...object.properties].reverse()) {
      if (isPropertyAssignment(member) && (isIdentifier(member.name) || isStringLiteral(member.name))) {
        if (member.name.text === name) return {node: member.initializer}
      } else if (isSpreadAssignment(member)) {
        // Не угадываем состав произвольного spread: он может перекрыть предыдущие поля.
        return object.properties.indexOf(member) === 0 ? property(member.expression, name) : undefined
      } else return undefined
    }
    return undefined
  }
  const required = new Set<VariableStatement>()
  const importReferences: Node[] = []
  const fragments = new Map<Node, {source: string; replacements: PreviewReplacement[]}>()
  const pending = [jsx]
  while (pending.length) {
    const root = pending.pop()!
    let source = ""
    const replacements: PreviewReplacement[] = []
    const indentation = (text: string, position: number): number => {
      const line = text.slice(text.lastIndexOf("\n", position - 1) + 1, position)
      return /^[ \t]*/u.exec(line)![0].length
    }
    const base = indentation(file.text, root.getStart(file))
    const emit = (node: Node, field?: string, child = false, shift = base): void => {
      const append = (start: number, end: number, layout = true): void => {
        const text = file.text.slice(start, end)
        source += layout ? text.replace(/(\r?\n)([ \t]*)/gu, (_, newline: string, spaces: string) =>
          newline + (shift < 0 ? " ".repeat(-shift) + spaces : spaces.slice(Math.min(shift, spaces.length)))) : text
      }
      if (ids.get(node) === propsId) {
        const start = source.length
        source += file.text.slice(node.getStart(file), node.end)
        replacements.push({start, end: source.length, ...(field === undefined ? {} : {property: field}), ...(child ? {child: true} : {})})
        return
      }
      if (isJsxExpression(node) && node.expression && isJsxElement(parents.get(node)!)) {
        const expression = node.expression
        if (isPropertyAccessExpression(expression)) {
          const value = property(expression.expression, expression.name.text)
          if (value && ids.get(value.node) === propsId) { emit(value.node, value.property, true); return }
        }
      }
      if (isPropertyAccessExpression(node)) {
        const value = property(node.expression, node.name.text)
        if (value) {
          const grouped = isBinaryExpression(value.node) || isConditionalExpression(value.node)
          if (grouped) source += "("
          const movedShift = indentation(file.text, value.node.getStart(file)) - indentation(source, source.length)
          emit(value.node, value.property, false, movedShift)
          if (grouped) source += ")"
          return
        }
      }
      if (isIdentifier(node)) {
        importReferences.push(node)
        const id = ids.get(node)
        const binding = id === undefined ? undefined : declarations.get(id)
        if (binding && binding.declaration.name !== node && !required.has(binding.statement)) {
          required.add(binding.statement)
          pending.push(binding.statement)
        }
      }
      let position = node.getStart(file)
      let hasChildren = false
      node.forEachChild(part => {
        hasChildren = true
        append(position, part.getStart(file))
        emit(part, undefined, false, shift)
        position = part.end
      })
      append(position, node.end, hasChildren || isJsxText(node))
    }
    emit(root)
    fragments.set(root, {source, replacements})
  }
  let source = ""
  const replacements: PreviewReplacement[] = []
  for (const node of [...setup.filter(statement => required.has(statement)), jsx]) {
    const fragment = fragments.get(node)!
    if (source) source += node === jsx ? "\n\n;" : "\n"
    replacements.push(...fragment.replacements.map(item => ({...item, start: item.start + source.length, end: item.end + source.length})))
    source += fragment.source
  }
  return {source, replacements, importReferences}
}
