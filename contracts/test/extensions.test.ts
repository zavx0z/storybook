import {expect, test} from "bun:test"
import {mkdir, symlink} from "node:fs/promises"
import {resolve} from "node:path"
import readContract from "@zavx0z/storybook-contracts"
import {createFixture} from "./fixture"

/** Подготавливает общий протокол и самостоятельного участника без исполнения их кода. */
async function extensionFixture(input: string) {
  const fixture = await createFixture("empty")
  await fixture.write("package.json", JSON.stringify({name: "@contract-fixture/group", type: "module", workspaces: ["child"],
    exports: {".": "./index.ts", "./contract": "./contract/index.ts"}, dependencies: {"@contract-fixture/child": "workspace:*"}}))
  await fixture.write("index.ts", 'export type {ContractFixtureGroup} from "./contract"\nexport {default as Child} from "@contract-fixture/child"\nexport type {ContractFixtureChild} from "@contract-fixture/child"\n')
  await fixture.write("contract/index.ts", 'export declare namespace ContractFixtureGroup {interface Input {readonly label: string}\ninterface Output {readonly label: string}}\n')
  await fixture.write("child/package.json", JSON.stringify({name: "@contract-fixture/child", type: "module",
    exports: {".": "./index.ts"}, dependencies: {"@contract-fixture/group": "workspace:*"}}))
  await fixture.write("child/index.ts", 'export type {ContractFixtureChild} from "./contract"\nthrow new Error("Не исполнять")\nexport default function child() {return {label: "child"}}\n')
  await fixture.write("child/contract/index.ts", `import type {ContractFixtureGroup} from "@contract-fixture/group/contract"\nexport declare namespace ContractFixtureChild {${input}\ninterface Output extends ContractFixtureGroup.Output {readonly selected?: boolean}}\n`)
  await mkdir(resolve(fixture.root, "node_modules/@contract-fixture"), {recursive: true})
  await symlink(resolve(fixture.root, "child"), resolve(fixture.root, "node_modules/@contract-fixture/child"))
  await symlink(fixture.root, resolve(fixture.root, "node_modules/@contract-fixture/group"))
  return fixture
}

test("кластер владеет общим протоколом, участник расширяет его без копирования", async () => {
  const fixture = await extensionFixture("interface Input extends ContractFixtureGroup.Input {readonly disabled?: boolean}")
  try {
    const result = await readContract({path: fixture.root})
    expect(result.diagnostics).toEqual([fixture.namingDiagnostic("ContractFixtureGroup"), fixture.namingDiagnostic("ContractFixtureChild", "child")])
    expect(result.extensions).toHaveLength(1)
    expect(result.extensions[0]?.base.owner?.name).toBe("@contract-fixture/group")
    expect(result.extensions[0]?.member.owner?.name).toBe("@contract-fixture/child")
    expect(result.extensions[0]?.roles).toEqual([
      {name: "Input", linked: true, compatible: true},
      {name: "Output", linked: true, compatible: true},
    ])
  } finally {
    await fixture.close()
  }
}, 30_000)

test.each([
  ["несовместимое расширение", "interface Input extends ContractFixtureGroup.Input {readonly label: number}", true],
  ["копия общей формы", "interface Input {readonly label: string}", false],
] as const)("%s не подтверждает общий протокол", async (_name, input, linked) => {
  const fixture = await extensionFixture(input)
  try {
    const result = await readContract({path: fixture.root})
    expect(result.extensions[0]?.roles.find(role => role.name === "Input")?.linked).toBe(linked)
    expect(result.diagnostics.some(diagnostic => diagnostic.code === "protocol-extension")).toBeTrue()
  } finally {
    await fixture.close()
  }
}, 30_000)


test("транзитивный alias сохраняет общее основание, совпадение конечного типа его не заменяет", async () => {
  const fixture = await extensionFixture("interface Input extends ContractFixtureGroup.Input {readonly disabled?: boolean}")
  try {
    await fixture.write("contract/index.ts", 'export declare namespace ContractFixtureGroup {interface Input {readonly label: string}\ntype Output = string}\n')
    await fixture.write("middle/package.json", JSON.stringify({name: "@contract-fixture/middle", type: "module", exports: {"./contract": "./contract/index.ts"}}))
    await fixture.write("middle/contract/index.ts", 'import type {ContractFixtureGroup} from "@contract-fixture/group/contract"\nexport declare namespace ContractFixtureMiddle {type Output = ContractFixtureGroup.Output}\n')
    await symlink(resolve(fixture.root, "middle"), resolve(fixture.root, "node_modules/@contract-fixture/middle"))
    const common = 'import type {ContractFixtureGroup} from "@contract-fixture/group/contract"\nimport type {ContractFixtureMiddle} from "@contract-fixture/middle/contract"\n'
    await fixture.write("child/contract/index.ts", common + 'export declare namespace ContractFixtureChild {interface Input extends ContractFixtureGroup.Input {}\ntype Output = ContractFixtureMiddle.Output}\n')
    const linked = await readContract({path: fixture.root})
    expect(linked.diagnostics).toEqual([fixture.namingDiagnostic("ContractFixtureGroup"), fixture.namingDiagnostic("ContractFixtureChild", "child")])
    expect(linked.extensions[0]?.roles.find(role => role.name === "Output")).toEqual({name: "Output", linked: true, compatible: true})
    expect(linked.sources.some(source => source.path.endsWith("/middle/contract/index.ts"))).toBeTrue()
    await fixture.write("child/contract/index.ts", common + 'export declare namespace ContractFixtureChild {interface Input extends ContractFixtureGroup.Input {}\ntype Output = string}\n')
    const copied = await readContract({path: fixture.root})
    expect(copied.extensions[0]?.roles.find(role => role.name === "Output")).toEqual({name: "Output", linked: false, compatible: true})
    expect(copied.diagnostics.some(diagnostic => diagnostic.code === "protocol-extension")).toBeTrue()
  } finally {
    await fixture.close()
  }
}, 30_000)
