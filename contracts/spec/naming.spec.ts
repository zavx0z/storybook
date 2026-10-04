/** Путь исходного владельца определяет namespace независимо от организации и npm-имени. */
import {describe, expect, test} from "bun:test"
import {mkdir, mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import readContract from "@zavx0z/storybook-contracts"
import {createFixture} from "../test/fixture"

describe.each([
  {name: "Организация zavx0z", packageName: "@zavx0z/storybook-app", mode: "correct"},
  {name: "Другая организация", packageName: "@other/storybook-app", mode: "correct"},
  {name: "Ошибочное npm-имя", packageName: "@wrong/completely-different", mode: "correct"},
  {name: "Npm-имя без scope", packageName: "unrelated", mode: "correct"},
  {name: "Организация попала в namespace", packageName: "@zavx0z/storybook-app", mode: "organization"},
  {name: "Потеряна вложенность", packageName: "@zavx0z/storybook-app", mode: "short"},
])("$name", ({packageName, mode}) => {
  test("Имя, предупреждение и доступность ролей", async () => {
    const fixture = await createFixture("empty")
    try {
      const namespaceName = mode === "correct" ? fixture.namespaceName
        : mode === "organization" ? `Zavx0z${fixture.namespaceName}` : "Contract"
      await fixture.write("package.json", JSON.stringify({name: packageName, type: "module", exports: {".": "./index.ts"}}))
      await fixture.write("index.ts", `export type {${namespaceName}} from "./contract"\nexport default function run(value: string) {return value.length}\n`)
      await fixture.write("contract/index.ts", `export declare namespace ${namespaceName} {type Input = {readonly value: string}\ntype Output = {readonly result: number}}\n`)
      const result = await readContract({path: fixture.root})
      const namespace = result.entries[0]?.namespaces[0]
      expect(namespace?.declaration.name).toBe(namespaceName)
      expect(result.diagnostics, "Ожидаемое имя определяется путём, а не корректностью npm-имени")
        .toEqual(mode === "correct" ? [] : [fixture.namingDiagnostic(namespaceName)])
      expect(namespace?.roles.map(role => role.name)).toEqual(["Input", "Output"])
      expect(namespace?.roles[0]?.fields).toMatchObject([{name: "value", type: "string", optional: false}])
      expect(namespace?.roles.find(role => role.name === "Output")?.fields)
        .toMatchObject([{name: "result", type: "number", optional: false}])
    } finally {
      await fixture.close()
    }
  })
})

test("Реэкспорт использует путь исходного владельца, включая дальних предков", async () => {
  const fixture = await createFixture("empty")
  try {
    const name = `${fixture.namespaceName}GrandparentParentChild`
    await fixture.write("grandparent/parent/child/package.json", JSON.stringify({name: "@unrelated/child", exports: {".": "./index.ts"}}))
    await fixture.write("grandparent/parent/child/index.ts", `export type {${name}} from "./contract"\nexport default 1\n`)
    await fixture.write("grandparent/parent/child/contract/index.ts", `export declare namespace ${name} {type Output = number}\n`)
    await fixture.write("index.ts", `export type {${name} as PublicName} from "./grandparent/parent/child"\nexport {default as Child} from "./grandparent/parent/child"\n`)
    const result = await readContract({path: fixture.root})
    expect(result.diagnostics).toEqual([])
    expect(result.entries[0]?.namespaces[0]?.name).toBe("PublicName")
    expect(result.entries[0]?.namespaces[0]?.declaration).toMatchObject({name, owner: {path: resolve(fixture.root, "grandparent/parent/child")}})
  } finally {
    await fixture.close()
  }
})

test("Без Repo имя не выводится из npm-адреса", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "namespace-no-repo-"))
  try {
    await mkdir(resolve(root, "contract"))
    await Bun.write(resolve(root, "package.json"), JSON.stringify({name: "@org/name", type: "module", exports: {".": "./index.ts"}}))
    await Bun.write(resolve(root, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], strict: true, module: "Preserve", moduleResolution: "bundler"}, include: ["**/*.ts"]}))
    await Bun.write(resolve(root, "index.ts"), 'export type {OrgName} from "./contract"\nexport default 1\n')
    await Bun.write(resolve(root, "contract/index.ts"), 'export declare namespace OrgName {type Output = number}\n')
    const result = await readContract({path: root})
    expect(result.diagnostics).toEqual([{
      severity: "warning",
      code: "namespace-name-context",
      path: resolve(result.root, "contract/index.ts"),
      message: "Имя namespace OrgName не проверено: Git-граница Repo исходного владельца не установлена",
    }])
    expect(result.entries[0]?.namespaces[0]?.roles.map(role => role.name)).toEqual(["Output"])
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
