import {afterAll, describe, expect, test} from "bun:test"
import {existsSync} from "node:fs"
import {resolve, dirname, relative} from "node:path"
import {API} from "typescript/unstable/async"
import {SyntaxKind, type Node, type Expression} from "typescript/unstable/ast"
import {isImportDeclaration, isExportDeclaration, isCallExpression, isIdentifier, isStringLiteral, isNoSubstitutionTemplateLiteral, isFunctionDeclaration} from "typescript/unstable/ast/is"

describe("Границы транспортных сущностей", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const proxy = resolve(root, "mcp/proxy")
  const transport = new Set(["server/control-client.ts", "server/server-state.ts", "server/security.ts"])
  const files = [...new Bun.Glob("**/*.ts").scanSync({cwd: resolve(root, "mcp/server"), absolute: true})]
    .filter(path => !path.includes("/spec/") && !path.includes("/test/"))
  const api = new API({cwd: root})
  afterAll(() => api.close())
  const snapshot = await api.updateSnapshot({openFiles: [...files, resolve(proxy, "index.ts")]})
  const readSource = async (path: string) => {
    const project = await snapshot.getDefaultProjectForFile(path)
    const source = await project?.program.getSourceFile(path)
    if (!source) throw new Error("Не найден исходник: " + path)
    return source
  }
  const imports = (source: Node) => {
    const values: string[] = []
    const walk = (node: Node) => {
      let specifier: Expression | undefined
      if (isImportDeclaration(node) || isExportDeclaration(node)) specifier = node.moduleSpecifier
      if (isCallExpression(node) && (node.expression.kind === SyntaxKind.ImportKeyword || (isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0]
      if (specifier) values.push(isStringLiteral(specifier) || isNoSubstitutionTemplateLiteral(specifier) ? specifier.text : "<dynamic>")
      node.forEachChild(walk)
    }
    walk(source)
    return values
  }

  test("прокси зависит только от своего контракта и HTTP-транспорта", async () => {
    const visited = new Set<string>()
    const violations: string[] = []
    const visit = async (path: string): Promise<void> => {
      if (visited.has(path)) return
      visited.add(path)
      if (!path.startsWith(proxy + "/") && !transport.has(relative(root, path))) {
        violations.push(relative(root, path))
        return
      }
      for (const specifier of imports(await readSource(path))) {
        if (specifier.startsWith("node:")) continue
        if (!specifier.startsWith(".")) violations.push(specifier)
        else {
          const base = resolve(dirname(path), specifier)
          const target = [base, base + ".ts", resolve(base, "index.ts")].find(candidate => candidate.endsWith(".ts") && existsSync(candidate))
          if (!target) violations.push(specifier)
          else await visit(target)
        }
      }
    }
    await visit(resolve(proxy, "index.ts"))
    expect(violations, "Прямые и транзитивные зависимости прокси не ведут в REST, Archetypes или форматировщики").toEqual([])
  })

  test("во входе находится только основная исполняемая сущность", async () => {
    for (const entry of ["mcp/proxy/index.ts", "mcp/server/index.ts"]) {
      const source = await readSource(resolve(root, entry))
      const functions = source.statements.filter(isFunctionDeclaration)
      expect(functions).toHaveLength(1)
      expect(functions[0]!.modifiers?.some(modifier => modifier.kind === SyntaxKind.ExportKeyword)).toBeTrue()
    }
  })

  test("MCP-адаптер не импортирует предметных HTTP-обработчиков", async () => {
    const violations: string[] = []
    for (const path of files) {
      for (const specifier of imports(await readSource(path))) {
        const resolved = specifier.startsWith(".") ? relative(root, resolve(dirname(path), specifier)) : specifier
        if (/^(?:mcp\/rest|archetypes|@mcp\/rest|@archetypes)(?:\/|$)/u.test(resolved)) violations.push(resolved)
      }
    }
    expect(violations, "Регистрация MCP не переносит предметную логику в транспортный процесс").toEqual([])
  })

  test("предметные зависимости не принадлежат runtime-пакету MCP", async () => {
    const manifest = await Bun.file(resolve(root, "mcp/package.json")).json()
    expect(Object.keys(manifest.dependencies).filter(name => /^(?:@archetypes\/|@mcp\/rest$)/u.test(name))).toEqual([])
    const rest = await Bun.file(resolve(root, "mcp/rest/package.json")).json()
    expect(rest.dependencies["@archetypes/specs"]).toBe("file:../../archetypes/specs")
  })
})
