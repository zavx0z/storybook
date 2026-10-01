import {lstat, readdir} from "node:fs/promises"
import {resolve} from "node:path"
import {isClassDeclaration, isEnumDeclaration, isInterfaceDeclaration, isTypeAliasDeclaration} from "typescript/unstable/ast/is"
import type {Node} from "typescript/unstable/ast"
import type {Namespace} from "../contract/declaration"
import {declarationOf} from "./declarations"
import {diagnose, rememberSource, type Context} from "./context"

/** Находит типовые исходники contract без обхода символических ссылок и вложенных пакетов. */
export async function contractFiles(root: string): Promise<string[]> {
  const result: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const info = await lstat(directory).catch(error => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (!info) return
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Контракт требует обычную директорию: ${directory}`)
    const entries = await readdir(directory, {withFileTypes: true}).catch(error => {
      if (error.code === "ENOENT") return []
      throw error
    })
    if (entries.some(entry => entry.name === "package.json")) return
    for (const entry of entries) {
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Контракт требует обычный файл или директорию: ${path}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name)) result.push(path)
    }
  }
  await visit(resolve(root, "contract"))
  return result.sort()
}

/**
Обратная сторона размещения: собственные типы, не участвующие в Input/Output/Slots,
остаются у реализации. Проверка не требует определённых имён вспомогательных файлов.
*/
export async function checkPlacement(files: readonly string[], namespaces: readonly Namespace[], context: Context): Promise<void> {
  const used = new Set(namespaces.flatMap(namespace => namespace.roles.flatMap(role => role.dependencies))
    .map(declaration => `${declaration.path}:${declaration.line}:${declaration.name}`))
  for (const path of files) {
    const source = await context.project.program.getSourceFile(path)
    if (!source) continue
    rememberSource(source, context)
    const declarations: Node[] = []
    const collect = (node: Node): void => {
      if (isInterfaceDeclaration(node) || isTypeAliasDeclaration(node) || isClassDeclaration(node) || isEnumDeclaration(node)) {
        declarations.push(node)
      }
      node.forEachChild(collect)
    }
    collect(source)
    for (const node of declarations) {
      if (!(isInterfaceDeclaration(node) || isTypeAliasDeclaration(node) || isClassDeclaration(node) || isEnumDeclaration(node)) || !node.name) continue
      const declaration = await declarationOf(node, node.name.text, context)
      if (declaration.owner?.path !== context.root) continue
      if (!used.has(`${declaration.path}:${declaration.line}:${declaration.name}`)) {
        diagnose(context, "type-outside-api", path,
          `Тип ${declaration.name} не входит в Input, Output или Slots; его место у использующей реализации`)
      }
    }
  }
}
