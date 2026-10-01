import {afterEach, expect, test} from "bun:test"
import {cp, mkdtemp, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import readContainer from "@archetypes/container"
import {readScenario} from "@storybook/app/scenarios"

const roots: string[] = []
const scenario = resolve(import.meta.dir, "../../archetypes/package/spec/scenario.spec.ts")
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

/** Копирует собственный workspace примера, сохраняя вложенность и независимость изменяемых случаев. */
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "container-boundary-")))
  roots.push(root)
  await cp(resolve(import.meta.dir, "../spec/fixture"), root, {recursive: true})
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

test("внешняя зависимость не превращает самостоятельный Component в Container", async () => {
  const f = await fixture()
  const path = join(f.path, "adjust/increment")
  await Bun.write(join(path, "index.ts"), '/**\nСамостоятельная реализация.\n@packageDocumentation\n*/\nimport double from "../../double/index.ts"\nexport default function increment(value: number) { return double(value) + 1 }\n')
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
  await Bun.write(entry, await Bun.file(entry).text() + '\nexport {default as Double} from "./double/index.ts"\n')
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
  await Bun.write(join(f.path, "index.ts"), '/**\nИзолированная реализация.\n@packageDocumentation\n*/\nexport default function compose(value: number) { return value }\n')
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
  await Bun.write(join(path, "index.ts"), '/**\nДинамическая композиция.\n@packageDocumentation\n*/\nexport default async function adjust(value: number) {\n  const {default: increment} = await import("./increment/index.ts")\n  return increment(value)\n}\n')
  const data = await readContainer({path})
  expect(data.parts[0]?.references).toMatchObject([{
    module: "./increment/index.ts", names: ["*"], public: true, typeOnly: false,
    owner: {name: "@fixture/compose-increment"},
  }])
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.tests.find(point => point.label === "Связи композиции")?.status).toBe("passed")
  expect(report.exitCode, report.stderr).toBe(0)
}, 30_000)
