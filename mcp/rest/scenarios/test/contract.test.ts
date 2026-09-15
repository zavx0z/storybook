import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {readContractDocumentations} from "../../../../discovery/contract-documentation"

test("публичные контракты сценариев проходят структурное обнаружение Storybook", async () => {
  const root = resolve(import.meta.dir, "../..")
  const input = resolve(import.meta.dir, "../contract/input.ts")
  const output = resolve(import.meta.dir, "../contract/output.ts")
  const result = await readContractDocumentations(root, [input, output])
  expect([...result.values()].map(value => value.document.declarations.map(declaration => declaration.name))).toEqual([
    ["ReadScenariosInput"], ["ReadScenariosOutput"],
  ])
})
