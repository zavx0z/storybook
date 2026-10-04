import {dirname, resolve} from "node:path"
import {realpath} from "node:fs/promises"
import type {Project} from "typescript/unstable/async"
import type {Node, SourceFile} from "typescript/unstable/ast"
import {SyntaxKind} from "typescript/unstable/ast"
import {isIdentifier, isImportDeclaration, isJsxOpeningElement, isJsxSelfClosingElement, isNamedImports, isNamespaceImport, isPropertyAccessExpression, isStringLiteral} from "typescript/unstable/ast/is"
import readPackageIndex from "@zavx0z/storybook-package-index"
import type {ScenarioSource} from "./types"

/** Проверяет разрешённый файл по exports его владельца; неизвестная форма не считается разрешением. */
async function publicEntry(path: string): Promise<boolean | null> {
  for (let root = dirname(path); ; root = dirname(root)) {
    const manifest = Bun.file(resolve(root, "package.json"))
    if (await manifest.exists()) {
      const metadata = await manifest.json()
      const exports = typeof metadata.exports === "string" ? {".": metadata.exports} : metadata.exports
      if (!exports || typeof exports !== "object") return null
      const index = await readPackageIndex({path: root, exports})
      for (const entry of index.entries) {
        if (!entry.entrypoint || !entry.target || !["owned", "forwarded"].includes(entry.status)) continue
        if (await realpath(resolve(root, entry.target)) === path) return true
      }
      return index.unchecked.length ? null : false
    }
    if (dirname(root) === root) return null
  }
}

/** Связывает JSX с импортами по символам, поэтому совпадение имени и локальное затенение не скрывают обёртку. */
export async function readComponentOrigins(file: SourceFile, project: Project): Promise<ScenarioSource["components"]> {
  const bindings: {node: Node; module: string; namespace: boolean}[] = []
  for (const statement of file.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)
      || statement.importClause?.phaseModifier === SyntaxKind.TypeKeyword) continue
    const clause = statement.importClause
    if (clause?.name) bindings.push({node: clause.name, module: statement.moduleSpecifier.text, namespace: false})
    const named = clause?.namedBindings
    if (named && isNamedImports(named)) for (const item of named.elements) {
      if (!item.isTypeOnly) bindings.push({node: item.name, module: statement.moduleSpecifier.text, namespace: false})
    }
    if (named && isNamespaceImport(named)) bindings.push({node: named.name, module: statement.moduleSpecifier.text, namespace: true})
  }
  const references: {tag: Node; binding: Node; namespace: boolean}[] = []
  const visit = (node: Node): void => {
    if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
      const tag = node.tagName
      if (isIdentifier(tag) && !/^[a-z]/u.test(tag.text)) references.push({tag, binding: tag, namespace: false})
      else if (isPropertyAccessExpression(tag)) references.push({tag, binding: tag.expression, namespace: true})
    }
    node.forEachChild(visit)
  }
  visit(file)
  if (!references.length) return []
  const symbols = await project.checker.getSymbolAtLocation([...bindings.map(item => item.node), ...references.map(item => item.binding)])
  const imports = new Map(symbols.slice(0, bindings.length).flatMap((symbol, index) => symbol ? [[symbol.id, bindings[index]!] as const] : []))
  const modules = new Map<string, Promise<boolean | null>>()
  return Promise.all(references.map(async (reference, index) => {
    const symbol = symbols[bindings.length + index]
    const binding = symbol ? imports.get(symbol.id) : undefined
    const module = binding?.module ?? null
    let published: boolean | null = false
    if (binding && binding.namespace === reference.namespace) {
      if (!modules.has(binding.module)) modules.set(binding.module, (async () => {
        try { return await publicEntry(await realpath(Bun.resolveSync(binding.module, dirname(file.fileName)))) }
        catch { return null }
      })())
      published = await modules.get(binding.module)!
    }
    const prefix = file.text.slice(0, reference.tag.getStart(file))
    return {name: reference.tag.getText(file), module, public: published,
      location: {path: file.fileName, line: prefix.split("\n").length, column: prefix.length - prefix.lastIndexOf("\n")}}
  }))
}
