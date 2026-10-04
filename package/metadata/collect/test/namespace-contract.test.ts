import {afterEach, expect, test} from "bun:test"
import {cp, mkdtemp, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import discover from "@zavx0z/storybook-package-metadata-collect"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-namespace-contract-")))
  roots.push(root)
  await cp(resolve(import.meta.dir, "fixture/namespace-contract"), root, {recursive: true})
  return root
}

test("namespace сохраняет три роли, вложенные поля, схему и точные источники", async () => {
  const root = await fixture()
  const catalog = await discover([root])
  const scope = catalog.scopes[0]!
  expect(scope.resolutionError).toBeUndefined()
  if (scope.kind !== "package") throw new Error("Ожидался пакет")
  const contract = scope.contractDocumentation!
  expect(contract.documents.map(entry => entry.direction)).toEqual(["input", "output", "slots"])
  const input = contract.documents.find(entry => entry.direction === "input")!.document.declarations[0]!
  expect(input.name).toBe("DiscoveryFixtureNamespaceContract.Input")
  expect(input.members.find(member => member.name === "options")!.children!.map(member => member.name))
    .toEqual(["limit", "enabled"])
  expect(input.schema?.properties?.options?.properties?.limit?.type).toBe("number")
  expect(contract.sources).toContainEqual({
    sourcePath: join(root, "contract/index.ts"),
    sourceDigest: new Bun.CryptoHasher("sha256").update(await Bun.file(join(root, "contract/index.ts")).arrayBuffer()).digest("hex"),
  })
  expect(scope.structurePaths).toContain(join(root, "contract/index.ts"))
}, 30_000)

test("два источника одной роли отклоняются с сохранением предыдущего документа", async () => {
  const root = await fixture()
  const before = await discover([root])
  await writeFile(join(root, "contract/input.ts"), "export type Input = string\n")
  const after = await discover([root], before)
  const scope = after.scopes[0]!
  expect(scope.resolutionError).toContain("одновременно объявлены")
  if (scope.kind !== "package" || before.scopes[0]!.kind !== "package") throw new Error("Ожидался пакет")
  expect(scope.contractDocumentation).toEqual(before.scopes[0]!.contractDocumentation)
}, 30_000)
