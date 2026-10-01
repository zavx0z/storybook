/** Domain раскрывает namespace владельцев и не создаёт собственного контракта. */
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readContract from "@archetypes/contracts"
import {createFixture} from "../test/fixture"

describe.each([
  {
    name: "Domain с runtime и типовым фасадом",
    entry: 'export {default as counter} from "./counter/index"\nexport type {ContractFixtureCounter} from "./counter/index"\n',
    exports: [{name: "counter", runtime: true}, {name: "ContractFixtureCounter", runtime: false}],
    namespace: true,
  },
  {
    name: "Domain только с типовым реэкспортом",
    entry: 'export type {ContractFixtureCounter} from "./counter/index"\n',
    exports: [{name: "ContractFixtureCounter", runtime: false}],
    namespace: true,
  },
  {
    name: "Domain без типового пространства",
    entry: 'export {default as counter} from "./counter/index"\n',
    exports: [{name: "counter", runtime: true}],
    namespace: false,
  },
])("$name", ({entry, exports, namespace}) => {
  test("Применимость без фиктивного контракта Domain", async () => {
    const fixture = await createFixture("empty")
    try {
      const owner = resolve(fixture.root, "counter")
      await fixture.write("counter/package.json", '{"name":"@contract-fixture/counter","exports":{".":"./index.ts"}}')
      await fixture.write("counter/index.ts", 'export type {ContractFixtureCounter} from "./contract"\nthrow new Error("Не исполнять")\nexport default function counter(value: number) {return value + 1}\n')
      await fixture.write("counter/contract/index.ts", 'export declare namespace ContractFixtureCounter {type Input = number\ntype Output = number}\n')
      await fixture.write("index.ts", entry)
      const result = await readContract({path: fixture.root})
      expect(result.entries[0]?.exports, "Domain публикует выбранный API своего владельца").toEqual([...exports])
      expect(result.diagnostics, "Отсутствие собственного Input/Output у Domain является применимостью").toEqual([])
      expect(result.entries[0]?.namespaces.map(value => value.declaration.owner),
        "Типовой фасад сохраняет исходного владельца, даже без runtime реэкспорта")
        .toEqual(namespace ? [{name: "@contract-fixture/counter", path: owner}] : [])
    } finally {
      await fixture.close()
    }
  })
})

test("Domain не присваивает контракт целого без собственной реализации", async () => {
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
