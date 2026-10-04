import {existsSync, lstatSync, readFileSync, readdirSync, realpathSync} from "node:fs"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import {API} from "typescript/unstable/async"
import {SyntaxKind, type Node, type SourceFile} from "typescript/unstable/ast"
import {isCallExpression, isExportDeclaration, isImportDeclaration, isNamedExports, isNamedImports, isStringLiteral} from "typescript/unstable/ast/is"
import type {Zavx0zStorybookPackageReader} from "@zavx0z/storybook-package-reader"

const OMIT_DIRECTORIES = new Set(["node_modules", "spec", "test", "tests", "fixture", "fixtures", "dist"])
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/u
const TEST_SOURCE = /\.(?:test|spec|fixture)\.[cm]?[jt]sx?$/u
type Snapshot = Awaited<ReturnType<API["updateSnapshot"]>>

/**
Проверяет структурное участие от всех собственных исходников целого.
Корневые ссылки уже раскрыты Package Reader; исходники достигнутых частей
читаются одним TypeScript AST snapshot без повторного typecheck.
Публичный фасад и type-only ссылка не создают ребро композиции.
Отдельный private src-вход с единственным runtime default может передавать
реализацию в другой realm; фактическую загрузку и вызов подтверждает сценарий.
*/
export async function runtimeOwnedParts(root: Zavx0zStorybookPackageReader.Output): Promise<ReadonlySet<string>> {
  const owned = new Map(root.packages.map(part => [part.path, part]))
  const named = new Map(root.packages.map(part => [part.name, part]))
  const reached = new Set<string>()
  const pending = root.code.flatMap(source => {
    const entry = relative(root.root, source.path).split(sep)[0] === "src"
      && source.exports.filter(value => value.runtime).length === 1
      && source.exports.some(value => value.runtime && value.name === "default" && !value.unresolved)
    return source.references.flatMap(reference =>
      !reference.typeOnly && (!reference.exported || entry) && reference.owner !== null && owned.has(reference.owner.path)
        ? [reference.owner.path] : [])
  })
  if (pending.length === 0) return reached
  const files = new Map(root.packages.map(part => [part.path, ownRuntimeSources(part.path)]))
  const api = new API({cwd: root.root})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [...new Set([...files.values()].flat())]})
    while (pending.length > 0) {
      const path = pending.pop()!
      if (reached.has(path)) continue
      reached.add(path)
      for (const source of files.get(path) ?? []) {
        for (const specifier of await runtimeImports(source, snapshot, path)) {
          const part = named.get(barePackageName(specifier))
          if (part === undefined || part.path === path || reached.has(part.path)) continue
          let target: string
          try {
            target = realpathSync(Bun.resolveSync(specifier, dirname(source)))
          } catch {
            continue
          }
          if (inside(part.path, target)) pending.push(part.path)
        }
      }
    }
    return reached
  } finally {
    await api.close()
  }
}

/** Совпадает с исходными областями Reader: собственный index/exports и src, без вложенных пакетов. */
function ownRuntimeSources(root: string): readonly string[] {
  const files = new Set<string>()
  const add = (path: string): void => {
    if (!inside(root, path) || !SOURCE_EXTENSION.test(path) || path.endsWith(".d.ts") || TEST_SOURCE.test(path)) return
    for (let directory = dirname(path); directory !== root; directory = dirname(directory)) {
      if (existsSync(join(directory, "package.json"))) return
    }
    const info = lstatSync(path, {throwIfNoEntry: false})
    if (info?.isFile() && !info.isSymbolicLink()) files.add(path)
  }
  for (const name of ["index.ts", "index.tsx", "index.mts", "index.cts", "index.js", "index.jsx", "index.mjs", "index.cjs"]) {
    add(join(root, name))
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>
  const exportTargets = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.startsWith("./") && !value.includes("*")) add(resolve(root, value))
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const target of Object.values(value)) exportTargets(target)
    }
  }
  exportTargets(manifest.exports)
  const visit = (directory: string): void => {
    if (!existsSync(directory) || existsSync(join(directory, "package.json"))) return
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (OMIT_DIRECTORIES.has(entry.name) || existsSync(join(path, "package.json"))) continue
        visit(path)
      } else if (entry.isFile()) add(path)
    }
  }
  visit(join(root, "src"))
  return [...files]
}

/** Один native AST snapshot различает import, type-only и re-export без checker. */
async function runtimeImports(path: string, snapshot: Snapshot, owner: string): Promise<ReadonlySet<string>> {
  const project = await snapshot.getDefaultProjectForFile(path)
  const file = await project?.program.getSourceFile(path)
  if (file === undefined) throw new Error(`TypeScript не прочитал исходник части: ${path}`)
  const result = new Set<string>()
  const exports = new Bun.Transpiler({loader: /\.[jt]sx$/u.test(path) ? "tsx" : "ts"}).scan(file.text).exports
  const entry = relative(owner, path).split(sep)[0] === "src" && exports.length === 1 && exports[0] === "default"
  const visit = (node: Node): void => {
    if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const named = clause?.namedBindings
      const onlyTypes = clause?.phaseModifier === SyntaxKind.TypeKeyword ||
        !!named && isNamedImports(named) && !clause?.name && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly)
      if (!onlyTypes) result.add(node.moduleSpecifier.text)
    } else if (entry && isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier
      && isStringLiteral(node.moduleSpecifier) && node.exportClause && isNamedExports(node.exportClause)
      && node.exportClause.elements.some(value => value.name.text === "default" && !value.isTypeOnly)) {
      result.add(node.moduleSpecifier.text)
    } else if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword &&
      node.arguments[0] && isStringLiteral(node.arguments[0])) {
      result.add(node.arguments[0].text)
    }
    node.forEachChild(visit)
  }
  visit(file as SourceFile)
  return result
}

function barePackageName(specifier: string): string {
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0] ?? ""
}

function inside(root: string, path: string): boolean {
  const value = relative(root, path)
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value)
}
