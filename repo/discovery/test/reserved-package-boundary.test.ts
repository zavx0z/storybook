import {expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import discoverStorybookPackages from "@zavx0z/storybook-repo-discovery"

test("вложенные пакеты contract и spec не становятся представлениями родителя при появлении и удалении package.json", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-reserved-packages-")))
  const contractRoot = join(root, "contract")
  const specRoot = join(root, "spec")
  const contractManifest = join(contractRoot, "package.json")
  const specManifest = join(specRoot, "package.json")
  const contractIndex = join(contractRoot, "index.ts")
  const scenario = join(specRoot, "scenario.spec.ts")
  const parentContract = "export declare namespace FixtureContract {\n  type Input = string\n  type Output = string\n}\n"
  try {
    await mkdir(contractRoot)
    await mkdir(specRoot)
    await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/reserved", workspaces: ["*"]}))
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ESNext", module: "ESNext", moduleResolution: "Bundler", noEmit: true}}))
    await writeFile(contractIndex, parentContract)
    await writeFile(scenario, 'throw new Error("Обнаружение не исполняет сценарий")\n')

    const ordinary = await discoverStorybookPackages([root])
    const parent = ordinary.scopes.find(scope => scope.scopeRoot === root)
    if (parent?.kind !== "package") throw new Error("Не найден родительский пакет")
    expect(parent.resolutionError).toBeUndefined()
    expect(parent.contractDocumentation?.documents.map(document => document.direction)).toEqual(["input", "output"])
    expect(parent.scenarioSpec?.sourcePaths).toEqual([scenario])
    expect(parent.structurePaths).toContain(contractManifest)
    expect(parent.structurePaths).toContain(specManifest)

    await writeFile(contractManifest, JSON.stringify({name: "@fixture/contract"}))
    await writeFile(specManifest, JSON.stringify({name: "@fixture/spec"}))
    await writeFile(contractIndex, '/** Собственный контрактный пакет. @packageDocumentation */\nexport default function value() { return "own" }\n')
    await writeFile(join(specRoot, "deps.spec.ts"), 'throw new Error("Чужая зависимость не принадлежит родителю")\n')

    const nested = await discoverStorybookPackages([root], ordinary)
    const nestedParent = nested.scopes.find(scope => scope.scopeRoot === root)
    if (nestedParent?.kind !== "package") throw new Error("Не найден родительский пакет")
    expect(nestedParent.resolutionError).toBeUndefined()
    expect(nestedParent.contractDocumentation).toBeUndefined()
    expect(nestedParent.scenarioSpec).toBeUndefined()
    expect(nestedParent.dependencySpec).toBeUndefined()
    expect(nestedParent.structurePaths).toContain(contractManifest)
    expect(nestedParent.structurePaths).toContain(specManifest)
    expect(nested.scopes.filter(scope => scope.kind === "package").map(scope => scope.id).sort()).toEqual([
      "@fixture/contract", "@fixture/reserved", "@fixture/spec",
    ])

    await rm(contractManifest)
    await rm(specManifest)
    await rm(join(specRoot, "deps.spec.ts"))
    await writeFile(contractIndex, parentContract)

    const restored = await discoverStorybookPackages([root], nested)
    const restoredParent = restored.scopes.find(scope => scope.scopeRoot === root)
    if (restoredParent?.kind !== "package") throw new Error("Не найден родительский пакет")
    expect(restored.scopes.filter(scope => scope.kind === "package").map(scope => scope.id)).toEqual(["@fixture/reserved"])
    expect(restoredParent.resolutionError).toBeUndefined()
    expect(restoredParent.contractDocumentation?.documents.map(document => document.direction)).toEqual(["input", "output"])
    expect(restoredParent.scenarioSpec?.sourcePaths).toEqual([scenario])
    expect(restoredParent.structurePaths).toContain(contractManifest)
    expect(restoredParent.structurePaths).toContain(specManifest)
  } finally {
    await rm(root, {recursive: true, force: true})
  }
}, 30_000)
