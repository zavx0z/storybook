/** Реэкспорт сохраняет исходный namespace; сам по себе фасад не подтверждает архетип. */
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readContract from "@zavx0z/storybook-contracts"
import {createFixture} from "../test/fixture"

describe.each([
  {
    name: "Runtime и типовой реэкспорт",
    entry: 'export {default as counter} from "./counter/index"\nexport type {ContractFixtureCounter} from "./counter/index"\n',
    exports: [{name: "counter", runtime: true}, {name: "ContractFixtureCounter", runtime: false}],
    namespace: true,
  },
  {
    name: "Только типовой реэкспорт",
    entry: 'export type {ContractFixtureCounter} from "./counter/index"\n',
    exports: [{name: "ContractFixtureCounter", runtime: false}],
    namespace: true,
  },
  {
    name: "Runtime без типового пространства",
    entry: 'export {default as counter} from "./counter/index"\n',
    exports: [{name: "counter", runtime: true}],
    namespace: false,
  },
])("$name", ({entry, exports, namespace}) => {
  test("Происхождение без присвоения контракта", async () => {
    const fixture = await createFixture("empty")
    try {
      const owner = resolve(fixture.root, "counter")
      await fixture.write("counter/package.json", '{"name":"@contract-fixture/counter","exports":{".":"./index.ts"}}')
      await fixture.write("counter/index.ts", 'export type {ContractFixtureCounter} from "./contract"\nthrow new Error("Не исполнять")\nexport default function counter(value: number) {return value + 1}\n')
      await fixture.write("counter/contract/index.ts", 'export declare namespace ContractFixtureCounter {type Input = number\ntype Output = number}\n')
      await fixture.write("index.ts", entry)
      const result = await readContract({path: fixture.root})
      expect(result.entries[0]?.exports, "Публикация раскрывает выбранный API его владельца").toEqual([...exports])
      expect(result.diagnostics, "Реэкспорт не создаёт новое соглашение владельца").toEqual([])
      expect(result.entries[0]?.namespaces.map(value => value.declaration.owner),
        "Типовой фасад сохраняет исходного владельца, даже без runtime реэкспорта")
        .toEqual(namespace ? [{name: "@contract-fixture/counter", path: owner}] : [])
    } finally {
      await fixture.close()
    }
  })
})

test("Одиночный type-only фасад не создаёт контракт реализации или группы", async () => {
  const fixture = await createFixture()
  try {
    await fixture.write("index.ts", 'export type {ContractFixtureCounter} from "./contract"\n')
    const result = await readContract({path: fixture.root})
    expect(result.diagnostics, "Собственный namespace требует собственной публичной runtime реализации")
      .toContainEqual(expect.objectContaining({code: "contract-without-implementation", path: resolve(fixture.root, "contract/index.ts")}))
  } finally {
    await fixture.close()
  }
})
