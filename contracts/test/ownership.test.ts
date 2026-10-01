import {describe, expect, test} from "bun:test"
import {rm} from "node:fs/promises"
import {resolve} from "node:path"
import readContract from "@archetypes/contracts"
import {createFixture} from "./fixture"

describe.each([
  {name: "Прямая форма выхода", expression: "Upstream.Output", fields: ["value", "label"], type: null},
  {name: "Выбор полей", expression: 'Pick<Upstream.Output, "value">', fields: ["value"], type: null},
  {name: "Indexed access к примитиву", expression: 'Upstream.Output["value"]', fields: [], type: "number"},
])("$name", ({expression, fields, type}) => {
  test("Типовая связь сохраняет происхождение", async () => {
    const fixture = await createFixture()
    try {
      await rm(resolve(fixture.root, "contract/value.ts"))
      await fixture.write("index.ts", 'export type {Counter} from "./contract"\nexport default function counter() {return 1}\n')
      const owner = resolve(fixture.root, "upstream")
      await fixture.write("upstream/package.json", '{"name":"@contract-fixture/upstream","exports":{".":"./index.ts"}}')
      await fixture.write("upstream/index.ts", 'export type {Upstream} from "./contract"\nexport default 1\n')
      await fixture.write("upstream/contract/index.ts", 'export declare namespace Upstream {type Output = {value: number, label?: string}}\n')
      await fixture.write("contract/index.ts", `import type {Upstream} from "../upstream/index"\nexport declare namespace Counter {type Input = ${expression}\ntype Output = number}\n`)
      const result = await readContract({path: fixture.root})
      const input = result.entries[0]?.namespaces[0]?.roles.find(role => role.name === "Input")
      expect(result.diagnostics, "Публичный вход владельца является допустимой типовой зависимостью").toEqual([])
      expect(input?.fields.map(value => value.name), "Native операция раскрывает связанную форму без копирования полей").toEqual([...fields])
      expect(input?.dependencies, "Даже primitive indexed access сохраняет исходное объявление Output другого владельца")
        .toContainEqual(expect.objectContaining({name: "Output", path: resolve(owner, "contract/index.ts"), owner: {name: "@contract-fixture/upstream", path: owner}, contract: true}))
      expect(input?.fields.flatMap(field => field.declarations).map(value => value.owner?.path),
        "Форма потребителя не переносит объявления полей из чужого пакета к себе")
        .toEqual(fields.map(() => owner))
      if (type) expect(input?.type, "Примитивная зависимость не разворачивается в свойства Number").toBe(type)
    } finally {
      await fixture.close()
    }
  })
})

test("Рекурсивные типы и callbacks читаются без зацикливания", async () => {
  const fixture = await createFixture()
  try {
    await rm(resolve(fixture.root, "contract/value.ts"))
    await fixture.write("index.ts", 'export type {Counter} from "./contract"\nexport default function counter() {return 1}\n')
    await fixture.write("contract/index.ts", 'import type {Node, Result} from "./graph"\nexport declare namespace Counter {type Input = Node\ntype Output = Result}\n')
    await fixture.write("contract/graph.ts", 'export interface Node {value: number\nnext?: Node\nonVisit?: (value: Result) => void}\nexport type Result = {visited: readonly Node[]}\n')
    const result = await readContract({path: fixture.root})
    const input = result.entries[0]?.namespaces[0]?.roles.find(role => role.name === "Input")
    expect(result.diagnostics, "Взаимно связанные собственные формы остаются внутри contract").toEqual([])
    expect(input?.fields.map(value => value.name), "Рекурсия не теряет next и callback").toEqual(["value", "next", "onVisit"])
    expect(input?.dependencies.filter(value => value.path === resolve(fixture.root, "contract/graph.ts")).map(value => value.name).sort(),
      "Зависимости содержат каждый рекурсивный тип один раз").toEqual(["Node", "Result"])
  } finally {
    await fixture.close()
  }
})

test("Форма не требует входа или специальных имён файлов", async () => {
  const fixture = await createFixture()
  try {
    await rm(resolve(fixture.root, "contract/value.ts"))
    await fixture.write("index.ts", 'export type {Counter} from "./contract"\nexport default function counter() {return 1}\n')
    await fixture.write("contract/index.ts", 'import type {Result} from "./result-model"\nexport declare namespace Counter {type Output = Result}\n')
    await fixture.write("contract/result-model.ts", 'export interface Detail {message: string}\nexport type Result = Detail | null\n')
    const result = await readContract({path: fixture.root})
    expect(result.diagnostics, "Применимая роль Output может быть единственной, её определения группируются по смыслу").toEqual([])
    expect(result.entries[0]?.namespaces[0]?.roles.map(value => value.name), "Отсутствующий Input не добавляется искусственно").toEqual(["Output"])
    expect(result.entries[0]?.namespaces[0]?.roles[0]?.dependencies.map(value => value.name).sort(),
      "Несколько declarations одного helper файла участвуют в одной форме").toEqual(["Detail", "Output", "Result"])
  } finally {
    await fixture.close()
  }
})
