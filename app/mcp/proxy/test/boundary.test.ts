import {afterAll, expect, test} from "bun:test"
import {resolve} from "node:path"
import {API} from "typescript/unstable/async"
import {isImportDeclaration, isStringLiteral} from "typescript/unstable/ast/is"

const root = resolve(import.meta.dir, "../../../..")
const entry = resolve(root, "app/mcp/proxy/index.ts")
const api = new API({cwd: root})
afterAll(() => api.close())

test("lazy proxy зависит от публичного server transport и не загружает предметный REST или controller", async () => {
  const snapshot = await api.updateSnapshot({openFiles: [entry]})
  const project = await snapshot.getDefaultProjectForFile(entry)
  const source = await project?.program.getSourceFile(entry)
  if (!source) throw new Error("Не найден публичный вход MCP proxy")
  const imports = source.statements.filter(isImportDeclaration).map(node =>
    isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "<dynamic>")
  expect(imports.filter(value => value.startsWith("@") && value !== "@zavx0z/storybook-app-server-state"),
  "Прокси не загружает HTTP-представление, контроллер или сценарии").toEqual([])
  expect(imports.some(value => value.includes("app/src/mcp") || value.includes("server/controller"))).toBeFalse()
})

test("предметный REST не зависит от управляющего MCP transport", async () => {
  const manifest = await Bun.file(resolve(root, "app/mcp/rest/package.json")).json()
  expect(Object.keys(manifest.dependencies ?? {}).some(name => name.startsWith("@zavx0z/storybook-app-server-") ||
    name === "@modelcontextprotocol/server" || name === "@storybook/app-old")).toBeFalse()
})
