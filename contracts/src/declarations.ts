import {SignatureKind, SymbolFlags, type Symbol as NativeSymbol, type Type} from "typescript/unstable/async"
import {SyntaxKind, type Node} from "typescript/unstable/ast"
import {isIdentifier, isInterfaceDeclaration, isTypeAliasDeclaration, isClassDeclaration, isEnumDeclaration, isFunctionDeclaration, isVariableDeclaration, isModuleDeclaration} from "typescript/unstable/ast/is"
import {resolve} from "node:path"
import type {Declaration} from "../contract/declaration"
import {diagnose, inside, ownerOf, rememberSource, type Context} from "./context"

/** Раскрывает импортное имя до исходного символа, сохраняя declaration identity. */
export async function originalSymbol(symbol: NativeSymbol, context: Context): Promise<NativeSymbol> {
  return symbol.flags & SymbolFlags.Alias ? context.project.checker.getAliasedSymbol(symbol) : symbol
}

/** Привязывает объявление к физическому пакету и строке исходника. */
export async function declarationOf(node: Node, name: string, context: Context): Promise<Declaration> {
  const source = node.getSourceFile()
  const owner = await ownerOf(source.fileName, context)
  if (owner && !source.fileName.includes("/node_modules/")) rememberSource(source, context)
  return {
    name,
    path: source.fileName,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    owner,
    contract: owner !== null && inside(resolve(owner.path, "contract"), source.fileName),
  }
}

/** Раскрывает исходные объявления символа без выполнения экспортирующего модуля. */
export async function declarationsOf(symbol: NativeSymbol, context: Context): Promise<Declaration[]> {
  const target = await originalSymbol(symbol, context)
  const result: Declaration[] = []
  for (const handle of target.declarations) {
    const node = await handle.resolve(context.project)
    if (node) result.push(await declarationOf(node, target.name, context))
  }
  return result
}

/**
Проходит по разрешённым символам всех типовых ссылок, включая callbacks, Pick,
indexed access, typeof и рекурсию. Чужой контракт остаётся у своего владельца;
его внутренние определения не становятся собственными типами потребителя.
Для проверки расширения протокола можно пройти транзитивную цепочку контрактов,
сохраняя исходного владельца каждого определения.
*/
export async function typeDependencies(symbol: NativeSymbol, owner: string, context: Context, followForeignContracts = false): Promise<Declaration[]> {
  const found = new Map<string, Declaration>()
  const visited = new Set<number>()
  const visitedTypes = new Set<number>()
  const visitType = async (type: Type | undefined): Promise<void> => {
    if (!type || visitedTypes.has(type.id) || type.isIntrinsicType() || type.isLiteralType()) return
    visitedTypes.add(type.id)
    const symbol = await type.getAliasSymbol() ?? await type.getSymbol()
    if (symbol) await visitSymbol(symbol)
    for (const argument of await type.getAliasTypeArguments()) await visitType(argument)
    if (type.isTypeReference()) {
      for (const argument of await context.project.checker.getTypeArguments(type)) await visitType(argument)
    }
    if (type.isUnionType() || type.isIntersectionType()) {
      for (const part of await type.getTypes()) await visitType(part)
    }
    if (symbol?.declarations.length) {
      const source = symbol.declarations[0]!.path
      if (source.includes("/node_modules/") || (await ownerOf(source, context))?.path !== owner) return
    }
    for (const property of await context.project.checker.getPropertiesOfType(type)) {
      await visitType(await context.project.checker.getTypeOfSymbol(property))
    }
    for (const kind of [SignatureKind.Call, SignatureKind.Construct]) {
      for (const signature of await context.project.checker.getSignaturesOfType(type, kind)) {
        for (const parameter of await signature.getParameters()) {
          await visitType(await context.project.checker.getTypeOfSymbol(parameter))
        }
        await visitType(await context.project.checker.getReturnTypeOfSignature(signature))
        for (const parameter of await signature.getTypeParameters()) {
          await visitType(await context.project.checker.getConstraintOfTypeParameter(parameter))
        }
      }
    }
  }
  const visitSymbol = async (candidate: NativeSymbol): Promise<void> => {
    const target = await originalSymbol(candidate, context)
    if (visited.has(target.id)) return
    visited.add(target.id)
    for (const handle of target.declarations) {
      const node = await handle.resolve(context.project)
      if (!node) continue
      if (isFunctionDeclaration(node) || isVariableDeclaration(node)) {
        const source = node.getSourceFile()
        if (!source.fileName.includes("/node_modules/") && (await ownerOf(source.fileName, context))?.path === owner) {
          rememberSource(source, context)
          await visitType(await context.project.checker.getTypeOfSymbol(target))
        }
        continue
      }
      if (!(isInterfaceDeclaration(node) || isTypeAliasDeclaration(node) || isClassDeclaration(node) || isEnumDeclaration(node))) continue
      const declaration = await declarationOf(node, target.name, context)
      if (!declaration.owner || declaration.path.includes("/node_modules/")) continue
      found.set(`${declaration.path}:${node.pos}`, declaration)
      if (declaration.owner.path !== owner && (!followForeignContracts || !declaration.contract)) continue
      if (!declaration.contract) {
        diagnose(context, "type-outside-contract", declaration.path,
          `Тип ${declaration.name} входит в публичный контракт и расположен вне contract своего владельца`)
      }
      const names: Node[] = []
      const collect = (child: Node): void => {
        if (isIdentifier(child)) names.push(child)
        child.forEachChild(collect)
      }
      collect(node)
      for (const name of names) {
        const referred = await context.project.checker.getSymbolAtLocation(name)
        if (referred) await visitSymbol(referred)
      }
    }
  }
  await visitSymbol(symbol)
  return [...found.values()].sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line)
}

/** Отличает явно объявленный ambient namespace от других экспортируемых типов. */
export async function namespaceDeclaration(symbol: NativeSymbol, context: Context): Promise<Node | null> {
  const target = await originalSymbol(symbol, context)
  for (const handle of target.declarations) {
    const node = await handle.resolve(context.project)
    if (node && isModuleDeclaration(node)) {
      if (!node.modifiers?.some(modifier => modifier.kind === SyntaxKind.DeclareKeyword)) {
        diagnose(context, "namespace-not-declared", node.getSourceFile().fileName,
          `Namespace ${target.name} объявляется через declare и не содержит runtime-реализации`)
      }
      return node
    }
  }
  return null
}
