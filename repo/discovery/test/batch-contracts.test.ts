import {afterEach, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import discoverStorybookPackages from "@storybook-repo/discovery"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

test("два владельца используют одну contract session; ошибка одного сохраняет его документ и обновляет соседа", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-contract-batch-")))
  roots.push(root)
  const alpha = join(root, "packages/alpha")
  const beta = join(root, "packages/beta")
  await mkdir(join(alpha, "contract"), {recursive: true})
  await mkdir(join(beta, "contract"), {recursive: true})
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/batch", workspaces: ["packages/*"]}))
  await writeFile(join(alpha, "package.json"), JSON.stringify({name: "@fixture/alpha"}))
  await writeFile(join(beta, "package.json"), JSON.stringify({name: "@fixture/beta"}))
  const alphaPath = join(alpha, "contract/index.ts")
  const betaPath = join(beta, "contract/index.ts")
  await writeFile(alphaPath, "export declare namespace Alpha { type Input = Readonly<{value: string}> }\n")
  await writeFile(betaPath, "export declare namespace Beta { type Input = Readonly<{count: number}> }\n")
  const firstSessions: string[] = []
  const before = await discoverStorybookPackages([root], undefined, {onAnalysisSession: kind => firstSessions.push(kind)})
  expect(firstSessions).toEqual(["contract"])
  const firstAlpha = before.scopes.find(scope => scope.id === "@fixture/alpha")!
  const firstBeta = before.scopes.find(scope => scope.id === "@fixture/beta")!
  expect(firstAlpha.resolutionError).toBeUndefined()
  expect(firstBeta.resolutionError).toBeUndefined()
  if (firstAlpha.kind !== "package" || firstBeta.kind !== "package") throw new Error("Ожидались два пакета")
  expect(firstAlpha.contractDocumentation?.documents[0]?.document.declarations[0]?.name).toBe("Alpha.Input")
  expect(firstBeta.contractDocumentation?.documents[0]?.document.declarations[0]?.name).toBe("Beta.Input")

  await writeFile(alphaPath, "export declare namespace Alpha { type Input =\n")
  await writeFile(betaPath, "export declare namespace Beta { type Input = Readonly<{count: number; label: string}> }\n")
  const nextSessions: string[] = []
  const after = await discoverStorybookPackages([root], before, {
    dirtyScopeRoots: [alpha, beta],
    onAnalysisSession: kind => nextSessions.push(kind),
  })
  expect(nextSessions).toEqual(["contract"])
  const nextAlpha = after.scopes.find(scope => scope.id === "@fixture/alpha")!
  const nextBeta = after.scopes.find(scope => scope.id === "@fixture/beta")!
  if (nextAlpha.kind !== "package" || nextBeta.kind !== "package") throw new Error("Ожидались два пакета")
  expect(nextAlpha.resolutionError).toContain("TypeDoc")
  expect(nextAlpha.contractDocumentation).toEqual(firstAlpha.contractDocumentation)
  expect(nextBeta.resolutionError).toBeUndefined()
  expect(nextBeta.contractDocumentation?.documents[0]?.document.declarations[0]?.members.map(member => member.name))
    .toEqual(["count", "label"])
  expect(nextBeta.contractDocumentation?.sources).toContainEqual({
    sourcePath: betaPath,
    sourceDigest: createHash("sha256").update(await readFile(betaPath)).digest("hex"),
  })
  expect(nextBeta.structurePaths).toContain(betaPath)
}, 30_000)
