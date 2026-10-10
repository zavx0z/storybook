import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {sourceModule} from "../src/source-module"

test("публичный root export подтверждает исходного вложенного владельца вместо ready facade", async () => {
  const specifier = "@zavx0z/immersive/ui/button/basic"
  const source = await sourceModule(specifier, import.meta.path)
  expect(source).toBe(resolve(import.meta.dir, "../../../../../immersive/ui/component/button/basic/index.tsx"))
  expect(Bun.resolveSync(specifier, import.meta.dir)).not.toBe(source)
  expect(await sourceModule("@zavx0z/immersive-ui-component-button-basic", source)).toBe(source)
})
