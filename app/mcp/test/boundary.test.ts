import {expect, test} from "bun:test"
import {readFileSync, readdirSync, realpathSync} from "node:fs"
import {dirname, join, resolve} from "node:path"

test("MCP owner получает App controller извне без runtime-импорта launcher", () => {
  const root = resolve(import.meta.dir, "../../..")
  const owner = join(root, "app/mcp")
  const files = [join(owner, "index.ts"), ...readdirSync(join(owner, "src"))
    .filter(name => name.endsWith(".ts"))
    .map(name => join(owner, "src", name))]
  const resolved = files.flatMap(path => {
    const imports = new Bun.Transpiler({loader: "ts"}).scanImports(readFileSync(path, "utf8"))
    return imports.filter(entry => !entry.path.startsWith("node:") && !entry.path.startsWith("bun:"))
      .map(entry => realpathSync(Bun.resolveSync(entry.path, dirname(path))))
  })
  expect(resolved).not.toContain(join(root, "app/index.ts"))
  expect(resolved).not.toContain(join(root, "app/src/mcp.ts"))
})
