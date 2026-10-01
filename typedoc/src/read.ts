import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {SignatureKind, type Project} from "typescript/unstable/async"
import {SyntaxKind, type Node} from "typescript/unstable/ast"
import {
  isModuleDeclaration, isTypeAliasDeclaration, isInterfaceDeclaration, isClassDeclaration,
  isFunctionDeclaration, isMethodDeclaration, isMethodSignatureDeclaration,
  isPropertySignatureDeclaration, isPropertyDeclaration, isSignatureDeclaration,
  isFunctionLikeDeclaration, isVariableDeclaration, isArrowFunction, isFunctionExpression,
} from "typescript/unstable/ast/is"
import {getLeadingCommentRanges} from "typescript/unstable/ast/scanner"
import readModuleDocumentation from "@archetypes/package-documentation"
import type {Declaration, Source} from "../contract/source"

/**
Отбирает doc-блоки узла штатным scanner, исключая модульный обзор.

@param node - Узел существующего исходника с сохранёнными позициями.

@returns Исходные блоки в порядке появления; комментарии соседних объявлений не включаются.
*/
function commentsOf(node: Node): string[] {
  const file = node.getSourceFile()
  return (getLeadingCommentRanges(file.text, node.getFullStart()) ?? [])
    .map(range => file.text.slice(range.pos, range.end))
    .filter(text => text.startsWith("/**") && readModuleDocumentation({path: file.fileName, source: text}) === null)
}

/**
Читает объявления файла, не копируя parser комментариев и не выполняя исходник.

@param path - Абсолютный путь исходника, включённого в snapshot проекта.

@param project - Текущая сессия TypeScript, принадлежащая вызывающему читателю.

@returns Объявления с native описаниями и тегами, модульный обзор и digest текста.

@throws Ошибка синтаксиса, отсутствие файла в snapshot либо изменение файла при чтении.
*/
export async function readSource(path: string, project: Project): Promise<Source> {
  const file = await project.program.getSourceFile(path)
  if (!file) throw new Error(`TypeScript не прочитал исходник: ${path}`)
  const errors = await project.program.getSyntacticDiagnostics(path)
  if (errors.length) throw new Error(errors.map(error => error.text).join("\n"))
  const nodes: Node[] = []
  /**
  Сохраняет именованные объявления, в том числе внутри ambient namespace.

  @param node - Узел текущего файла; обход включает собственные вложенные объявления.
  */
  const collect = (node: Node): void => {
    if (isModuleDeclaration(node) || isTypeAliasDeclaration(node) || isInterfaceDeclaration(node)
      || isClassDeclaration(node) || isFunctionDeclaration(node)
      || isMethodDeclaration(node)
      || isVariableDeclaration(node) && node.initializer && (isArrowFunction(node.initializer) || isFunctionExpression(node.initializer))) nodes.push(node)
    node.forEachChild(collect)
  }
  collect(file)
  const declarations: Declaration[] = []
  for (const node of nodes) {
    if (!(isModuleDeclaration(node) || isTypeAliasDeclaration(node) || isInterfaceDeclaration(node)
      || isClassDeclaration(node) || isFunctionDeclaration(node)
      || isMethodDeclaration(node) || isVariableDeclaration(node)) || !node.name) continue
    const symbol = await project.checker.getSymbolAtLocation(node.name)
    if (!symbol) throw new Error(`Не найден символ объявления ${node.name.getText()}: ${path}`)
    const comments = commentsOf(isVariableDeclaration(node) ? node.parent.parent : node)
    const callable = isVariableDeclaration(node) && node.initializer ? node.initializer : node
    const prefixes: string[] = []
    for (let parent = node.parent; parent; parent = parent.parent) {
      if ((isModuleDeclaration(parent) || isTypeAliasDeclaration(parent) || isInterfaceDeclaration(parent)
        || isClassDeclaration(parent)) && parent.name) prefixes.unshift(parent.name.getText())
    }
    const properties: string[] = []
    const inlineProperties: string[] = []
    const members: Node[] = []
    const callables: string[] = []
    const signature = isSignatureDeclaration(callable) ? await project.checker.getSignatureFromDeclaration(callable) : undefined
    const returnType = signature ? await project.checker.getReturnTypeOfSignature(signature) : undefined
    let throws = false
    /**
    Находит собственные поля и throw, не присваивая вложенные функции родительской сигнатуре.

    @param child - Узел обследуемого объявления; вложенная callable-реализация имеет свой обход.
    */
    const inspect = (child: Node): void => {
      if (isPropertySignatureDeclaration(child) || isPropertyDeclaration(child) || isMethodSignatureDeclaration(child)) {
        properties.push(child.name.getText())
        members.push(child)
        if (commentsOf(child).length) inlineProperties.push(child.name.getText())
        return
      }
      if (child !== callable && child !== node && isFunctionLikeDeclaration(child)) return
      if (child.kind === SyntaxKind.ThrowStatement) throws = true
      child.forEachChild(inspect)
    }
    if (!isModuleDeclaration(node)) inspect(node)
    for (const member of members) {
      if (!(isPropertySignatureDeclaration(member) || isPropertyDeclaration(member) || isMethodSignatureDeclaration(member))) continue
      const memberSymbol = await project.checker.getSymbolAtLocation(member.name)
      const type = memberSymbol ? await project.checker.getTypeOfSymbol(memberSymbol) : undefined
      if (type && (await project.checker.getSignaturesOfType(type, SignatureKind.Call)).length) callables.push(member.name.getText())
    }
    declarations.push({
      name: [...prefixes, node.name.getText()].join("."),
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      summary: comments.length ? await symbol.getDocumentationComment(project.checker) : "",
      comments,
      tags: comments.length ? (await symbol.getJsDocTags(project.checker)).map(tag => ({name: tag.name, text: tag.text ?? ""})) : [],
      parameters: isSignatureDeclaration(callable) ? callable.parameters.map(parameter => parameter.name.getText()) : [],
      typeParameters: "typeParameters" in callable ? callable.typeParameters?.map(parameter => parameter.name.getText()) ?? [] : [],
      properties, callables, inlineProperties,
      returns: returnType ? await project.checker.typeToString(returnType) : null,
      throws,
    })
  }
  const content = await readFile(path, "utf8")
  if (content !== file.text) throw new Error(`Источник изменился при чтении TypeDoc: ${path}`)
  return {path, digest: createHash("sha256").update(file.text).digest("hex"),
    module: readModuleDocumentation({path, source: file.text})?.markdown ?? null, declarations}
}
