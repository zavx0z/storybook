/** Нарушения публичной границы не превращаются в успешные примеры использования. */
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readContract from "@archetypes/contracts"
import {createFixture} from "../test/fixture"

describe.each([
  {
    name: "Нет пространства контракта",
    files: {"index.ts": 'export default function increment() {return 1}\n'},
    code: "namespace-missing",
    path: "index.ts",
  },
  {
    name: "Лишний корневой тип",
    files: {"index.ts": 'export default function increment() {return 1}\nexport type {Counter} from "./contract"\nexport interface Extra {value: number}\n'},
    code: "component-exports",
    path: "index.ts",
  },
  {
    name: "Namespace опубликован вне своего входа",
    files: {
      "index.ts": 'export default function increment() {return 1}\nexport type {Counter} from "./contract/other"\n',
      "contract/other.ts": 'export declare namespace Counter {type Output = number}\n',
    },
    code: "namespace-entry",
    path: "contract/other.ts",
  },
  {
    name: "Namespace без declare",
    files: {"contract/index.ts": 'export namespace Counter {export type Input = {value: number}\nexport type Output = number}\n'},
    code: "namespace-not-declared",
    path: "contract/index.ts",
  },
  {
    name: "Значение не заменяет типовую роль",
    files: {"contract/index.ts": 'export declare namespace Counter {const Input: number\ntype Output = number}\n'},
    code: "namespace-role",
    path: "contract/index.ts",
  },
  {
    name: "Неприменимая роль",
    files: {"contract/index.ts": 'export declare namespace Counter {type Input = {value: number}\ntype Output = number\ntype Extra = string}\n'},
    code: "namespace-member",
    path: "contract/index.ts",
  },
  {
    name: "Тип только реализации ошибочно размещён в contract",
    files: {
      "contract/cache.ts": 'export interface Cache {readonly previous: number}\n',
      "src/increment.ts": 'import type {Cache} from "../contract/cache"\nexport function stepOf(step?: number) {const cache: Cache = {previous: step ?? 1}\nreturn cache.previous}\n',
    },
    code: "type-outside-api",
    path: "contract/cache.ts",
  },
  {
    name: "Собственная форма вынесена из contract",
    files: {
      "contract/index.ts": 'import type {Shape} from "../src/shape"\nexport declare namespace Counter {type Input = Shape\ntype Output = number}\n',
      "src/shape.ts": 'export interface Shape {value: number}\n',
    },
    code: "type-outside-contract",
    path: "src/shape.ts",
  },
  {
    name: "typeof раскрывает собственные типы публичной сигнатуры",
    files: {
      "contract/index.ts": 'import type {helper} from "../src/helper"\nexport declare namespace Counter {type Input = number\ntype Output = typeof helper}\n',
      "src/helper.ts": 'import type {Details} from "./details"\nexport function helper(input: Details): number {return input.value}\n',
      "src/details.ts": 'export interface Details {readonly value: number}\n',
    },
    code: "type-outside-contract",
    path: "src/details.ts",
  },
  {
    name: "Вложенный callback использует частный собственный тип",
    files: {
      "contract/index.ts": 'import type {Listener} from "./callbacks"\nexport declare namespace Counter {type Input = {value: number, onValue: Listener}\ntype Output = number}\n',
      "contract/callbacks.ts": 'import type {Details} from "../src/details"\nexport type Listener = (value: Details) => void\n',
      "src/details.ts": 'export interface Details {description: string}\n',
    },
    code: "type-outside-contract",
    path: "src/details.ts",
  },
  {
    name: "Тип заимствован из частного входа другого пакета",
    files: {
      "contract/index.ts": 'import type {Upstream} from "../upstream/contract/index"\nexport declare namespace Counter {type Input = Upstream.Output\ntype Output = number}\n',
      "upstream/package.json": '{"name":"@contract-fixture/upstream","exports":{".":"./index.ts"}}',
      "upstream/index.ts": 'export type {Upstream} from "./contract"\nexport default 1\n',
      "upstream/contract/index.ts": 'export declare namespace Upstream {type Output = {value: number}}\n',
    },
    code: "private-dependency",
    path: "contract/index.ts",
  },
])("$name", ({files, code, path}) => {
  test("Диагностика исходного нарушения", async () => {
    const fixture = await createFixture()
    try {
      for (const [path, text] of Object.entries(files)) await fixture.write(path, text)
      const result = await readContract({path: fixture.root})
      expect(result.diagnostics, "Нарушение сохраняет предметный код и точный исходник для исправления")
        .toContainEqual(expect.objectContaining({code, path: resolve(fixture.root, path)}))
      expect(result.diagnostics.find(value => value.code === code)?.message,
        "Диагностика объясняет нарушение публичной границы").toMatch(/\S/u)
    } finally {
      await fixture.close()
    }
  })
})

test("Результат JSX не подменяет заявленные точки вставки", async () => {
  const fixture = await createFixture("jsx-component")
  try {
    await fixture.write("contract/index.ts", 'import type {JSX} from "@zavx0z/jsx"\nexport declare namespace Panel {type Input = {readonly title: string}\ntype Slots = {readonly default: JSX.Element, readonly header?: JSX.Element}\ntype Output = JSX.Element<{readonly wrong: JSX.Element}>}\n')
    const result = await readContract({path: fixture.root})
    expect(result.entries[0]?.namespaces[0]?.slotsLinked,
      "Наличие JSX.Element само по себе не связывает его чужую форму wrong с объявленными Slots").toBeFalse()
    expect(result.diagnostics, "Несогласованный контракт точек вставки сохраняет диагностику у владельца")
      .toContainEqual(expect.objectContaining({code: "slots-result", path: resolve(fixture.root, "contract/index.ts")}))
  } finally {
    await fixture.close()
  }
})
