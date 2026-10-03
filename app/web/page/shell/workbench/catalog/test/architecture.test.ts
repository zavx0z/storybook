import {expect, test} from "bun:test"
import {readFileSync} from "node:fs"
import {join} from "node:path"

test("каталог использует production Tree и не создаёт видимые узлы вручную", () => {
  const source = readFileSync(join(import.meta.dir, "../src/navigation-tree.tsx"), "utf8")
  expect(source).toContain('from "@zavx0z/ui/widget/tree"')
  expect(source).toContain("<Tree")
  expect(source).not.toContain("createElement(")
})
