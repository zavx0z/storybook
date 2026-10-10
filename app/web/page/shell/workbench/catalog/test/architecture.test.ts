import {expectNamedUiImport} from "../../../test/fixture/ui-ownership.ts"
import {expect, test} from "bun:test"
import {readFileSync} from "node:fs"
import {join} from "node:path"

test("каталог использует production Tree и не создаёт видимые узлы вручную", () => {
  const source = readFileSync(join(import.meta.dir, "../src/navigation-tree.tsx"), "utf8")
  expectNamedUiImport(source, "Tree")
  expect(source).toContain("<Tree")
  expect(source).not.toContain("createElement(")
})
