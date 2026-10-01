import {afterAll, expect, test} from "bun:test"
import {existsSync, readFileSync, realpathSync} from "node:fs"
import {isBuiltin} from "node:module"
import {dirname, join, relative, resolve} from "node:path"
import {API} from "typescript/unstable/async"
import {SyntaxKind, type Node} from "typescript/unstable/ast"
import {isImportDeclaration, isExportDeclaration, isCallExpression, isStringLiteral, isImportTypeNode, isNamedImports, isNamedExports} from "typescript/unstable/ast/is"

const root = resolve(import.meta.dir, "..")
const files = [...new Bun.Glob("**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}").scanSync({cwd: join(root, "app"), absolute: true})]
  .filter(path => !path.includes("/node_modules/"))
const api = new API({cwd: root})
afterAll(() => api.close())

/** Находит физическую границу исходника, включая вложенные пакеты приложения. */
function owner(path: string): string {
  let directory = dirname(realpathSync(path))
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`Нет владельца ${path}`)
    directory = parent
  }
  return directory
}

test("все исходники app используют свои модули или объявленные публичные зависимости", async () => {
  const snapshot = await api.updateSnapshot({openFiles: files})
  const violations: string[] = []
  for (const path of files) {
    const project = await snapshot.getDefaultProjectForFile(path)
    const source = await project?.program.getSourceFile(path)
    if (!source) throw new Error(`Не прочитан ${path}`)
    const own = owner(path)
    const manifest = JSON.parse(readFileSync(join(own, "package.json"), "utf8"))
    const modules: {module: string, typeOnly: boolean, exported: boolean}[] = []
    /** AST сохраняет и type-only ссылки, которые стираются при транспиляции. */
    const visit = (node: Node): void => {
      if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause
        const named = clause?.namedBindings
        modules.push({module: node.moduleSpecifier.text, exported: false,
          typeOnly: clause?.phaseModifier === SyntaxKind.TypeKeyword
            || !!named && isNamedImports(named) && !clause?.name && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly)})
      } else if (isExportDeclaration(node) && node.moduleSpecifier && isStringLiteral(node.moduleSpecifier)) {
        modules.push({module: node.moduleSpecifier.text, exported: true,
          typeOnly: node.isTypeOnly || !!node.exportClause && isNamedExports(node.exportClause) && node.exportClause.elements.every(item => item.isTypeOnly)})
      } else if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword && node.arguments[0] && isStringLiteral(node.arguments[0])) {
        modules.push({module: node.arguments[0].text, typeOnly: false, exported: false})
      } else if (isImportTypeNode(node) && "literal" in node.argument && isStringLiteral(node.argument.literal as Node)) {
        modules.push({module: (node.argument.literal as import("typescript/unstable/ast").StringLiteral).text, typeOnly: true, exported: false})
      }
      node.forEachChild(visit)
    }
    visit(source)
    for (const {module, typeOnly, exported} of modules) {
      if (isBuiltin(module) || module.startsWith("bun:")) continue
      const label = `${relative(root, path)} → ${module}`
      if (module.startsWith("/") || module.startsWith("file:")) {
        violations.push(label)
        continue
      }
      try {
        const target = Bun.resolveSync(module, dirname(path))
        if (module.startsWith(".")) {
          if (owner(target) !== own) violations.push(label)
        } else {
          const name = module.startsWith("@") ? module.split("/").slice(0, 2).join("/") : module.split("/")[0]!
          const testSource = /\.(test|spec)\.[cm]?[jt]sx?$/u.test(path) || path.includes("/test/") || path.includes("/spec/")
          const dependencies = {...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies,
            ...(testSource || typeOnly && !exported ? manifest.devDependencies : {})}
          if (name !== manifest.name && !(name in dependencies)) violations.push(label)
        }
      } catch {
        violations.push(label)
      }
    }
  }
  expect(violations).toEqual([])
})
