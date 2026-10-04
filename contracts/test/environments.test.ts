import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readContract from "@zavx0z/storybook-contracts"
import readPackage from "@zavx0z/storybook-package-reader"
import {createFixture} from "./fixture"

test("средовые протоколы и документы читаются без общего index и без исполнения", async () => {
  const fixture = await createFixture("empty")
  try {
    await fixture.write("package.json", JSON.stringify({name: "@contract-fixture/domain", type: "module",
      exports: {".": {browser: "./web.ts", node: "./server.ts"}}}))
    await fixture.write("contract/message.ts", "export interface Message {readonly text: string}\n")
    for (const name of ["web", "server"]) {
      await fixture.write(`${name}.ts`, `/** Вход ${name}.\n@packageDocumentation\n*/\nimport type {ContractFixtureDomain} from "./contract/${name}"\nexport type {ContractFixtureDomain} from "./contract/${name}"\nthrow new Error("Исследуемый код не исполняется")\nexport default function entry(input: ContractFixtureDomain.Input): ContractFixtureDomain.Output {return input.message.text}\n`)
      await fixture.write(`contract/${name}.ts`, `import type {Message} from "./message"\nexport declare namespace ContractFixtureDomain {interface Input {readonly message: Message\nreadonly ${name}?: boolean}\ntype Output = string}\n`)
    }
    const result = await readContract({path: fixture.root})
    expect(result.entries.map(entry => ({path: entry.exportPath, conditions: entry.conditions})))
      .toEqual([{path: ".", conditions: ["browser"]}, {path: ".", conditions: ["node"]}])
    expect(result.entries.map(entry => entry.namespaces[0]?.declaration.path))
      .toEqual([resolve(fixture.root, "contract/web.ts"), resolve(fixture.root, "contract/server.ts")])
    expect(result.diagnostics).toEqual([])
    const description = await readPackage({path: fixture.root})
    expect(description.documentation).toBeNull()
    expect(description.entryDocumentation.map(entry => entry.documentation?.markdown)).toEqual(["Вход web.", "Вход server."])
    expect(description.index.entries.map(entry => entry.input)).toEqual(["./contract/web.ts", "./contract/server.ts"])
    expect(result.entries.every(entry => entry.namespaces[0]?.roles.some(role =>
      role.dependencies.some(value => value.path === resolve(fixture.root, "contract/message.ts"))))).toBeTrue()
  } finally {
    await fixture.close()
  }
}, 30_000)
