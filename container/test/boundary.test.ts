import {afterEach, expect, test} from "bun:test"
import {mkdir, rm, symlink} from "node:fs/promises"
import {join, resolve} from "node:path"
import readContainer from "@archetypes/container"
import readScenario from "@archetypes/scenario-reader"
import {prepareContainerExample} from "../spec/prepare"

const roots: string[] = []
const scenario = resolve(import.meta.dir, "../../package/reader/spec/scenario.spec.ts")
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

/** Копирует собственный workspace примера, сохраняя вложенность и независимость изменяемых случаев. */
async function fixture() {
  const root = await prepareContainerExample()
  roots.push(root)
  return {root, path: join(root, "compose")}
}

test("читатель Container является Component, а его сценарии доступны как исполняемая документация", async () => {
  const path = resolve(import.meta.dir, "..")
  const standard = await readScenario({path: scenario, props: {path}})
  expect(standard.exitCode, standard.stderr).toBe(0)
  expect(standard.tests.find(point => point.label === "Самостоятельная реализация")?.status).toBe("passed")
  expect(standard.tests.find(point => point.label === "Принадлежащие части")?.status).toBe("skipped")
  const example = await readScenario({path: resolve(path, "spec/scenario.spec.ts")})
  expect(example.exitCode, example.stderr).toBe(0)
  expect(example.validation.checks.filter(check => check.status === "failed")).toEqual([])
  expect(example.tests.filter(point => point.status !== "passed")).toEqual([])
  expect(example.calls.filter(call => call.name === "default")).toHaveLength(2)
}, 30_000)

test("непосредственный состав не присваивает части вложенного контейнера", async () => {
  const f = await fixture()
  const result = await readContainer({path: f.path})
  expect(result.parts.map(part => part.name).sort()).toEqual(["@fixture/compose-adjust", "@fixture/compose-double"])
  const nested = await readContainer({path: join(f.path, "adjust")})
  expect(nested.parts.map(part => part.name)).toEqual(["@fixture/compose-increment"])
})

test("вложенный Container и его компонент проходят разные частные разделы одного стандарта", async () => {
  const f = await fixture()
  for (const [path, container] of [[join(f.path, "adjust"), true], [join(f.path, "adjust/increment"), false]] as const) {
    const report = await readScenario({path: scenario, props: {path}})
    expect(report.exitCode, report.stderr).toBe(0)
    expect(report.validation.checks.filter(check => check.status === "failed")).toEqual([])
    expect(report.tests.find(point => point.label === "Принадлежащие части")?.status).toBe(container ? "passed" : "skipped")
    expect(report.tests.find(point => point.label === "Самостоятельная реализация")?.status).toBe(container ? "skipped" : "passed")
    expect(report.tests.filter(point => point.status !== "passed" && !(point.status === "skipped" && point.skipReason))).toEqual([])
  }
}, 30_000)

test("прямая композиция подтверждает обе непосредственные части", async () => {
  const f = await fixture()
  const report = await readScenario({path: scenario, props: {path: f.path}})
  expect(report.tests.find(point => point.label === "Связи композиции")?.status).toBe("passed")
  expect(report.exitCode, report.stderr).toBe(0)
}, 30_000)

test("общая часть участвует через другой принадлежащий Container без прямого импорта родителя", async () => {
  const f = await fixture()
  await Bun.write(join(f.path, "index.ts"), `
/**
Составляет части через вложенный Container.
@packageDocumentation
*/
import adjust from "@fixture/compose-adjust"
export type {FixtureCompose} from "./contract"
export default function compose(value: number) { return adjust(value) }
`)
  await Bun.write(join(f.path, "adjust/index.ts"), `
/**
Использует собственную часть и общую часть родителя.
@packageDocumentation
*/
import increment from "@fixture/compose-increment"
import double from "@fixture/compose-double"
export type {FixtureComposeAdjust} from "./contract"
export default function adjust(value: number) { return double(increment(value)) }
`)
  const path = join(f.path, "adjust/package.json")
  const manifest = await Bun.file(path).json()
  await Bun.write(path, JSON.stringify({...manifest, dependencies: {
    ...manifest.dependencies,
    "@fixture/compose-double": "workspace:*",
  }}))
  const direct = await readContainer({path: f.path})
  expect(direct.parts.find(part => part.name === "@fixture/compose-double")?.references).toEqual([])
  const report = await readScenario({path: scenario, props: {path: f.path}})
  expect(report.tests.find(point => point.label === "Связи композиции")?.status).toBe("passed")
  expect(report.exitCode, report.stderr).toBe(0)
}, 30_000)

test("одна используемая часть не подтверждает вторую, связанную только типом", async () => {
  const f = await fixture()
  await Bun.write(join(f.path, "index.ts"), `
/** Реализация с неполным составом. @packageDocumentation */
import adjust from "@fixture/compose-adjust"
import type double from "@fixture/compose-double"
export type {FixtureCompose} from "./contract"
export default function compose(value: number) { return adjust(value) }
`)
  const report = await readScenario({path: scenario, props: {path: f.path}})
  expect(report.tests.find(point => point.label === "Связи композиции")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)

test("внешняя runtime-зависимость не заменяет неиспользуемую принадлежащую часть", async () => {
  const f = await fixture()
  const external = join(f.root, "external")
  await mkdir(external)
  await Bun.write(join(external, "package.json"), JSON.stringify({
    name: "@fixture/external", type: "module", exports: {".": "./index.ts"},
  }))
  await Bun.write(join(external, "index.ts"), "export default function external(value: number) { return value }\n")
  await symlink(external, join(f.root, "node_modules/@fixture/external"))
  const path = join(f.path, "package.json")
  const manifest = await Bun.file(path).json()
  await Bun.write(path, JSON.stringify({...manifest, dependencies: {
    ...manifest.dependencies,
    "@fixture/external": "workspace:*",
  }}))
  await Bun.write(join(f.path, "index.ts"), `
/** Внешняя зависимость не является частью целого. @packageDocumentation */
import adjust from "@fixture/compose-adjust"
import external from "@fixture/external"
export type {FixtureCompose} from "./contract"
export default function compose(value: number) { return external(adjust(value)) }
`)
  const report = await readScenario({path: scenario, props: {path: f.path}})
  expect(report.tests.find(point => point.label === "Связи композиции")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)

test("цикл частей обрывается и не оживляет отсоединённую группу", async () => {
  const f = await fixture()
  await Bun.write(join(f.path, "adjust/index.ts"), `
/** Цикл связей частей. @packageDocumentation */
import increment from "@fixture/compose-increment"
import "@fixture/compose-double"
export type {FixtureComposeAdjust} from "./contract"
export default function adjust(value: number) { return increment(value) }
`)
  await Bun.write(join(f.path, "double/index.ts"), `
/** Обратная ссылка цикла. @packageDocumentation */
import "@fixture/compose-adjust"
export type {FixtureComposeDouble} from "./contract"
export default function double(value: number) { return value * 2 }
`)
  const path = join(f.path, "adjust/package.json")
  const manifest = await Bun.file(path).json()
  await Bun.write(path, JSON.stringify({...manifest, dependencies: {
    ...manifest.dependencies,
    "@fixture/compose-double": "workspace:*",
  }}))
  await Bun.write(join(f.path, "index.ts"), `
/** Связанный цикл частей. @packageDocumentation */
import adjust from "@fixture/compose-adjust"
export type {FixtureCompose} from "./contract"
export default function compose(value: number) { return adjust(value) }
`)
  const connected = await readScenario({path: scenario, props: {path: f.path}})
  expect(connected.tests.find(point => point.label === "Связи композиции")?.status).toBe("passed")
  await Bun.write(join(f.path, "index.ts"), `
/** Отсоединённый цикл частей. @packageDocumentation */
export type {FixtureCompose} from "./contract"
export default function compose(value: number) { return value }
`)
  const disconnected = await readScenario({path: scenario, props: {path: f.path}})
  expect(disconnected.tests.find(point => point.label === "Связи композиции")?.status).toBe("failed")
}, 40_000)

test("внешняя зависимость не превращает самостоятельный Component в Container", async () => {
  const f = await fixture()
  const path = join(f.path, "adjust/increment")
  await Bun.write(join(path, "index.ts"), '/**\nСамостоятельная реализация.\n@packageDocumentation\n*/\nimport double from "@fixture/compose-double"\nexport type {FixtureComposeIncrement} from "./contract"\nexport default function increment(value: number) { return double(value) + 1 }\n')
  const metadata = await Bun.file(join(path, "package.json")).json()
  await Bun.write(join(path, "package.json"), JSON.stringify({...metadata, dependencies: {"@fixture/compose-double": "workspace:*"}}))
  const data = await readContainer({path})
  expect(data.parts).toEqual([])
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.exitCode, report.stderr).toBe(0)
  expect(report.tests.find(point => point.label === "Самостоятельная реализация")?.status).toBe("passed")
  expect(report.tests.find(point => point.label === "Принадлежащие части")?.status).toBe("skipped")
}, 30_000)

test("контейнер не раскрывает именованный runtime API внутренней части", async () => {
  const f = await fixture()
  const entry = join(f.path, "index.ts")
  await Bun.write(entry, await Bun.file(entry).text() + '\nexport {default as Double} from "@fixture/compose-double"\n')
  const report = await readScenario({path: scenario, props: {path: f.path}})
  expect(report.tests.find(point => point.label === "Основная реализация")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)

test("контейнер не открывает часть отдельным кодовым подпутём", async () => {
  const f = await fixture()
  const file = join(f.path, "package.json")
  const metadata = await Bun.file(file).json()
  await Bun.write(file, JSON.stringify({...metadata, exports: {...metadata.exports, "./double": "./double/index.ts"}}))
  const report = await readScenario({path: scenario, props: {path: f.path}})
  expect(report.tests.find(point => point.label === "Публичное целое")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)

test("вложенные пакеты без участия в реализации не подтверждают композицию", async () => {
  const f = await fixture()
  await Bun.write(join(f.path, "index.ts"), '/**\nИзолированная реализация.\n@packageDocumentation\n*/\nexport type {FixtureCompose} from "./contract"\nexport default function compose(value: number) { return value }\n')
  const report = await readScenario({path: scenario, props: {path: f.path}})
  expect(report.tests.find(point => point.label === "Структурная роль")?.status).toBe("passed")
  expect(report.tests.find(point => point.label === "Связи композиции")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)

test("читатель не исполняет исследуемый контейнер", async () => {
  const f = await fixture()
  const entry = join(f.path, "index.ts")
  await Bun.write(entry, await Bun.file(entry).text() + '\nthrow new Error("Исследуемый код не исполняется")\n')
  const data = await readContainer({path: f.path})
  expect(data.component.entries[0]?.exports).toEqual(["default"])
  expect(data.parts).toHaveLength(2)
})

test("буквальный dynamic import сохраняет часть композиции и её публичного владельца", async () => {
  const f = await fixture()
  const path = join(f.path, "adjust")
  await Bun.write(join(path, "contract/index.ts"), '/** Числовой вход и асинхронный результат композиции. */\nexport declare namespace FixtureComposeAdjust {\n  type Input = number\n  type Output = Promise<number>\n}\n')
  await Bun.write(join(path, "index.ts"), '/**\nДинамическая композиция.\n@packageDocumentation\n*/\nimport type {FixtureComposeAdjust} from "./contract"\nexport type {FixtureComposeAdjust} from "./contract"\nexport default async function adjust(value: FixtureComposeAdjust.Input): FixtureComposeAdjust.Output {\n  const {default: increment} = await import("@fixture/compose-increment")\n  return increment(value)\n}\n')
  const data = await readContainer({path})
  expect(data.parts[0]?.references).toMatchObject([{
    module: "@fixture/compose-increment", names: ["*"], public: true, typeOnly: false,
    owner: {name: "@fixture/compose-increment"},
  }])
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.tests.find(point => point.label === "Связи композиции")?.status).toBe("passed")
  expect(report.exitCode, report.stderr).toBe(0)
}, 30_000)
