import {isBuiltin} from "node:module"
import {API, SymbolFlags, type Project, type Symbol as TypeScriptSymbol} from "typescript/unstable/async"
import {SyntaxKind, type Node, type SourceFile} from "typescript/unstable/ast"
import {
  isCallExpression, isClassDeclaration, isEmptyStatement, isExportAssignment, isExportDeclaration,
  isFunctionDeclaration, isIdentifier, isImportDeclaration, isInterfaceDeclaration,
  isModuleBlock, isModuleDeclaration, isNamedExports, isNamedImports,
  isStringLiteral, isTypeAliasDeclaration, isVariableStatement, isImportTypeNode,
} from "typescript/unstable/ast/is"
import {dirname, resolve} from "node:path"
import {lstat, realpath, readFile} from "node:fs/promises"
import readPackageIndex from "@archetypes/package-index"
import type {ReadPackageOutput} from "../contract/output"

type Source = ReadPackageOutput["code"][number]
type Owner = NonNullable<Source["exports"][number]["declarations"][number]["owner"]>

/** Читает ближайшую идентичность владельца объявления; исходник не исполняется. */
async function sourceOwner(path: string): Promise<Owner | null> {
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    const metadata = resolve(directory, "package.json")
    const info = await lstat(metadata).catch(error => {
      if (error.code !== "ENOENT") throw error
      return null
    })
    if (info?.isFile() && !info.isSymbolicLink()) {
      const value = JSON.parse(await readFile(metadata, "utf8"))
      return typeof value.name === "string" ? {path: directory, name: value.name} : null
    }
    if (dirname(directory) === directory) return null
  }
}

/** Выделяет исполняемые объявления и эффекты; импорты значений сами не являются реализацией фасада. */
function localStatements(file: SourceFile): Source["statements"] {
  const statements: string[] = []
  const visit = (node: Node): void => {
    if ("modifiers" in node && (node.modifiers as readonly Node[] | undefined)?.some(item => item.kind === SyntaxKind.DeclareKeyword)) return
    if (isInterfaceDeclaration(node) || isTypeAliasDeclaration(node) || isEmptyStatement(node)) return
    if (isImportDeclaration(node)) {
      if (!node.importClause || node.importClause.phaseModifier !== SyntaxKind.TypeKeyword
        && node.importClause.namedBindings && isNamedImports(node.importClause.namedBindings)
        && node.importClause.namedBindings.elements.length === 0) statements.push("side-effect import")
      return
    }
    if (isExportDeclaration(node)) return
    if (isModuleDeclaration(node)) {
      if (node.body && isModuleBlock(node.body)) node.body.statements.forEach(visit)
      else if (node.body) visit(node.body)
      return
    }
    if (isExportAssignment(node) && isIdentifier(node.expression)) return
    if (isFunctionDeclaration(node) && !node.body) return
    statements.push(isFunctionDeclaration(node) || isClassDeclaration(node)
      ? node.name?.text ?? "default"
      : isVariableStatement(node) ? node.declarationList.declarations.map(item => item.name.getText(file)).join(", ")
      : SyntaxKind[node.kind])
  }
  file.statements.forEach(visit)
  return statements
}

/** Проверяет публичность разрешённого модуля у его собственного владельца, включая ветви сред. */
async function publicModule(path: string, owner: Owner | null, ownRoot: string): Promise<boolean | null> {
  if (!owner) return null
  if (owner.path === ownRoot) return true
  const metadata = JSON.parse(await readFile(resolve(owner.path, "package.json"), "utf8"))
  const declared = typeof metadata.exports === "string" ? {".": metadata.exports} : metadata.exports ?? {}
  const index = await readPackageIndex({path: owner.path, exports: declared})
  const published = index.entries.some(entry => entry.target && ["owned", "forwarded"].includes(entry.status)
    && [resolve(owner.path, entry.target), resolve(owner.path, entry.target).replace(/\.js$/u, ".d.ts")
      .replace(/\.mjs$/u, ".d.mts").replace(/\.cjs$/u, ".d.cts")].includes(path))
  return published ? true : index.unchecked.length > 0 || metadata.exports === undefined ? null : false
}

/** Читает import/export, буквальный dynamic import и ссылки import type, сохраняя владельца без исполнения модулей. */
async function moduleReferences(file: SourceFile, project: Project, root: string): Promise<Source["references"]> {
  const nodes: {node: Node, module: string, names: readonly string[], typeOnly: boolean, exported: boolean}[] = []
  const visit = (node: Node): void => {
    if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const named = clause?.namedBindings
      nodes.push({node: node.moduleSpecifier, module: node.moduleSpecifier.text,
        names: [...(clause?.name ? ["default"] : []), ...(named && isNamedImports(named) ? named.elements.map(item => item.propertyName?.text ?? item.name.text) : named ? ["*"] : [])],
        typeOnly: clause?.phaseModifier === SyntaxKind.TypeKeyword || !!named && isNamedImports(named) && !clause?.name && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly),
        exported: false})
    } else if (isExportDeclaration(node) && node.moduleSpecifier && isStringLiteral(node.moduleSpecifier)) {
      nodes.push({node: node.moduleSpecifier, module: node.moduleSpecifier.text,
        names: node.exportClause && isNamedExports(node.exportClause) ? node.exportClause.elements.map(item => item.propertyName?.text ?? item.name.text) : ["*"],
        typeOnly: node.isTypeOnly || !!node.exportClause && isNamedExports(node.exportClause) && node.exportClause.elements.every(item => item.isTypeOnly),
        exported: true})
    } else if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword
      && node.arguments[0] && isStringLiteral(node.arguments[0])) {
      nodes.push({node: node.arguments[0], module: node.arguments[0].text,
        names: ["*"], typeOnly: false, exported: false})
    } else if (isImportTypeNode(node) && "literal" in node.argument && isStringLiteral(node.argument.literal as Node)) {
      const literal = node.argument.literal as import("typescript/unstable/ast").StringLiteral
      nodes.push({node: literal, module: literal.text, names: [node.qualifier?.getText(file) ?? "*"], typeOnly: true, exported: false})
    }
    node.forEachChild(visit)
  }
  visit(file)
  const result: Source["references"][number][] = []
  for (const reference of nodes) {
    const symbol = await project.checker.getSymbolAtLocation(reference.node)
    const declaration = symbol?.declarations[0]
    const path = declaration ? await realpath(declaration.path).catch(() => null) : null
    const owner = path && !isBuiltin(reference.module) ? await sourceOwner(path) : null
    result.push({from: file.fileName, module: reference.module, names: reference.names, typeOnly: reference.typeOnly,
      exported: reference.exported, path, owner, public: isBuiltin(reference.module) ? true : path ? await publicModule(path, owner, root) : null})
  }
  return result
}

/**
Раскрывает native символы публичного API и ссылки контрактов одним TypeScript snapshot.
Реэкспорт сохраняет владельцев исходных объявлений; type-only не превращается в runtime.
Не создаёт классификацию и не исполняет код проверяемых пакетов.
*/
export async function readSourceExports(root: string, paths: readonly string[]): Promise<ReadPackageOutput["code"]> {
  if (!paths.length) return []
  const api = new API({cwd: root})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [...paths]})
    const result: Source[] = []
    const pending = new Set(paths)
    for (const path of pending) {
      const project = await snapshot.getDefaultProjectForFile(path)
      const file = await project?.program.getSourceFile(path)
      if (!project || !file) throw new Error(`TypeScript не прочитал публичный вход: ${path}`)
      const module = await project.checker.getSymbolAtLocation(file)
      const symbols = module ? await project.checker.getExportsOfModule(module) : []
      const explicitTypes = new Set<string>()
      let runtimeStar = false
      for (const node of file.statements) if (isExportDeclaration(node)) {
        if (!node.exportClause && !node.isTypeOnly) runtimeStar = true
        if (node.exportClause && isNamedExports(node.exportClause)) for (const item of node.exportClause.elements) {
          if (node.isTypeOnly || item.isTypeOnly) explicitTypes.add(item.name.text)
        }
      }
      const runtime = new Set(new Bun.Transpiler({loader: /\.[jt]sx$/u.test(path) ? "tsx" : "ts"}).scan(file.text).exports)
      const exports: Source["exports"][number][] = []
      const contracts = new Set<string>()
      for (const symbol of symbols) {
        const target: TypeScriptSymbol = symbol.flags & SymbolFlags.Alias ? await project.checker.getAliasedSymbol(symbol) : symbol
        const unresolved = await project.checker.isUnknownSymbol(target)
        const declarations: Source["exports"][number]["declarations"][number][] = []
        for (const handle of target.declarations) {
          const source = await realpath(handle.path).catch(() => null)
          if (!source) continue
          const owner = await sourceOwner(source)
          declarations.push({path: source, owner})
          if (owner?.path === root && source !== path) contracts.add(source)
        }
        const value = !explicitTypes.has(symbol.name) && (runtime.has(symbol.name) || runtimeStar && (target.flags & SymbolFlags.Value) !== 0)
        const declaration = await (target.valueDeclaration ?? target.declarations[0])?.resolve(project)
        const type = declaration ? await project.checker.getTypeAtLocation(declaration) : undefined
        exports.push({name: symbol.name, runtime: value, declarations, type: type ? await project.checker.typeToString(type) : null, unresolved})
      }
      const references = [...await moduleReferences(file, project, root)]
      for (const reference of references) {
        if (reference.owner?.path === root && reference.path) pending.add(reference.path)
      }
      for (const contract of contracts) {
        const source = await project.program.getSourceFile(contract)
        if (source) {
          const dependencies = await moduleReferences(source, project, root)
          references.push(...dependencies)
          for (const reference of dependencies) {
            if (reference.owner?.path === root && reference.path && reference.path !== path) contracts.add(reference.path)
          }
        }
      }
      result.push({path, exports, statements: localStatements(file), references})
    }
    return result
  } finally {
    await api.close()
  }
}
