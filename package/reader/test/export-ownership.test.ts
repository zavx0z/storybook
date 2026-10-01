import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import {pathToFileURL} from "node:url"
import readPackage from "@archetypes/package"
import readDomain from "@archetypes/domain"
import readScenario from "@archetypes/scenario-reader"

const roots: string[] = []
const scenario = resolve(import.meta.dir, "../spec/scenario.spec.ts")
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

/** Создаёт настоящий workspace с доменом и компонентом; никакая классификация в данных не записана. */
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "archetype-exports-")))
  roots.push(root)
  const domain = join(root, "area")
  const component = join(domain, "value")
  await mkdir(join(component, "spec"), {recursive: true})
  await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/repo", workspaces: ["area/**"]}))
  await Bun.write(join(domain, "package.json"), JSON.stringify({name: "@fixture/area", description: "Область значений", exports: {".": "./index.ts"}, dependencies: {"@fixture/value": "workspace:*"}}))
  await Bun.write(join(component, "package.json"), JSON.stringify({name: "@fixture/value", description: "Числовое значение", exports: {".": "./index.ts"}}))
  await Bun.write(join(component, "index.ts"), '/** Числовое значение.\n@packageDocumentation\n*/\nexport interface Output {value: number}\nconst value: Output = {value: 3}\nexport default value\n')
  await Bun.write(join(component, "spec/scenario.spec.ts"), 'import {test, expect} from "bun:test"\nimport value from "../index.ts"\ntest("значение", () => expect(value.value).toBe(3))\n')
  await Bun.write(join(domain, "index.ts"), '/** Область значений.\n@packageDocumentation\n*/\nexport {default as Value} from "@fixture/value"\nexport type {Output} from "@fixture/value"\n')
  await mkdir(join(domain, "node_modules/@fixture"), {recursive: true})
  await symlink(component, join(domain, "node_modules/@fixture/value"))
  return {root, domain, component}
}

test("реэкспорт сохраняет владельца реализации и именованный тип без исполнения", async () => {
  const f = await fixture()
  await Bun.write(join(f.component, "index.ts"), '/** Вход не исполняется.\n@packageDocumentation\n*/\nthrow new Error("Не исполнять")\nexport interface Output {value: number}\nexport default function value(): Output {return {value: 3}}\n')
  const result = await readDomain({path: f.domain})
  expect(result.localCode).toEqual([])
  const exports = result.package.code[0]!.exports
  expect(exports.find(item => item.name === "Value")).toMatchObject({runtime: true, unresolved: false,
    declarations: [{path: join(f.component, "index.ts"), owner: {path: f.component, name: "@fixture/value"}}]})
  expect(exports.find(item => item.name === "Output")?.runtime).toBeFalse()
})

test("один нормативный сценарий принимает доменный фасад и default-значение без фиктивного output.ts", async () => {
  const f = await fixture()
  for (const path of [f.domain, f.component]) {
    const report = await readScenario({path: scenario, props: {path}})
    expect(report.exitCode, report.stderr).toBe(0)
    expect(report.tests.filter(point => point.status === "failed")).toEqual([])
  }
}, 30_000)

test("условные входы среды принадлежат Domain и раскрывают разные API", async () => {
  const f = await fixture()
  await Bun.write(join(f.domain, "package.json"), JSON.stringify({name: "@fixture/area", description: "Разные среды", exports: {".": {browser: "./browser.ts", node: "./server.ts"}}, dependencies: {"@fixture/value": "workspace:*"}}))
  await Bun.write(join(f.domain, "browser.ts"), 'export {default as BrowserValue} from "@fixture/value"')
  await Bun.write(join(f.domain, "server.ts"), 'export {default as ServerValue} from "@fixture/value"')
  const result = await readPackage({path: f.domain})
  expect(result.index.entries.map(entry => entry.conditions)).toEqual([["browser"], ["node"]])
  expect(result.code.flatMap(source => source.exports.filter(item => item.runtime).map(item => item.name)).sort())
    .toEqual(["BrowserValue", "ServerValue", "Value"])
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.exitCode, report.stderr).toBe(0)
}, 30_000)

test("именованный runtime экспорт не подменяет default компонента", async () => {
  const f = await fixture()
  await Bun.write(join(f.component, "index.ts"), '/** Значение.\n@packageDocumentation\n*/\nexport const value = 3')
  const report = await readScenario({path: scenario, props: {path: f.component}})
  expect(report.tests.find(point => point.label === "Основная реализация")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)

test("эффект в фасаде не становится разрешённым поведением домена", async () => {
  const f = await fixture()
  await Bun.write(join(f.domain, "index.ts"), '/** Область.\n@packageDocumentation\n*/\nexport {default as Value} from "@fixture/value"\nconsole.log("effect")')
  expect((await readDomain({path: f.domain})).localCode).toEqual(["."])
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.tests.find(point => point.label === "Структурная роль")?.status).toBe("failed")
}, 30_000)

test("типовой re-export класса не создаёт runtime, а частный импорт владельца отклоняется", async () => {
  const f = await fixture()
  await Bun.write(join(f.component, "private.ts"), 'export class Secret {}')
  await Bun.write(join(f.domain, "index.ts"), '/** Типовой вход.\n@packageDocumentation\n*/\nexport type {Secret} from "./value/private.ts"')
  const result = await readPackage({path: f.domain})
  expect(result.code[0]!.exports[0]?.runtime).toBeFalse()
  expect(result.code[0]!.references[0]?.public).toBeFalse()
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.tests.find(point => point.label === "Публичные владельцы")?.status).toBe("failed")
}, 30_000)

test("фасад не скрывает собственный runtime в частном импортированном модуле", async () => {
  const f = await fixture()
  await Bun.write(join(f.domain, "helper.ts"), 'console.log("effect")\nexport const token = 1')
  await Bun.write(join(f.domain, "index.ts"), 'import {token} from "./helper.ts"\nexport {default as Value} from "@fixture/value"')
  expect((await readDomain({path: f.domain})).localCode).toContain("helper.ts")
})

test("default не заменяет именованный API домена", async () => {
  const f = await fixture()
  await Bun.write(join(f.domain, "index.ts"), '/** Область.\n@packageDocumentation\n*/\nexport {default} from "@fixture/value"')
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.tests.find(point => point.label === "Происхождение API")?.status).toBe("failed")
}, 30_000)

test("нераскрытый wildcard владельца сохраняет неполноту проверки вместо ложного нарушения", async () => {
  const f = await fixture()
  await Bun.write(join(f.component, "package.json"), JSON.stringify({name: "@fixture/value", exports: {"./*": "./*.ts"}}))
  await Bun.write(join(f.domain, "index.ts"), 'export {default as Value} from "@fixture/value/index"')
  const data = await readPackage({path: f.domain})
  expect(data.code[0]!.references[0]?.public).toBeNull()
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.tests.find(point => point.label === "Публичные владельцы")?.status).toBe("passed")
  expect(report.tests.find(point => point.label === "Полнота публичных границ")?.status).toBe("todo")
}, 30_000)

test("runtime импорт требует зависимости поставки, внутренний тип может оставаться в devDependencies", async () => {
  const f = await fixture()
  await mkdir(join(f.component, "node_modules/@fixture"), {recursive: true})
  const upstream = join(f.component, "node_modules/@fixture/upstream")
  await mkdir(upstream)
  await Bun.write(join(upstream, "package.json"), JSON.stringify({name: "@fixture/upstream", exports: {".": "./index.ts"}}))
  await Bun.write(join(upstream, "index.ts"), 'export interface Output {value: number}\nexport default 1')
  await Bun.write(join(f.component, "package.json"), JSON.stringify({name: "@fixture/value", description: "Потребитель", exports: {".": "./index.ts"}, devDependencies: {"@fixture/upstream": "*"}}))
  await Bun.write(join(f.component, "index.ts"), '/** Потребитель.\n@packageDocumentation\n*/\nimport upstream from "@fixture/upstream"\nexport default function consume() {return upstream}')
  const runtime = await readScenario({path: scenario, props: {path: f.component}})
  expect(runtime.tests.find(point => point.label === "Объявленные зависимости")?.status).toBe("failed")
  await Bun.write(join(f.component, "index.ts"), '/** Потребитель.\n@packageDocumentation\n*/\nimport type {Output} from "@fixture/upstream"\nexport default function consume() {const internal: Output = {value: 1}\nreturn internal.value}')
  const types = await readScenario({path: scenario, props: {path: f.component}})
  expect(types.tests.find(point => point.label === "Объявленные зависимости")?.status).toBe("passed")
}, 30_000)

test("development является режимом и не открывает корневой файл как отдельную среду", async () => {
  const f = await fixture()
  await Bun.write(join(f.domain, "package.json"), JSON.stringify({name: "@fixture/area", description: "Область", exports: {".": {development: "./development.ts", default: "./index.ts"}}, dependencies: {"@fixture/value": "workspace:*"}}))
  await Bun.write(join(f.domain, "development.ts"), 'export {default as Value} from "@fixture/value"')
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.tests.find(point => point.label === "Входы сред домена")?.status).toBe("failed")
}, 30_000)

test.each(["./value", "./jsx-runtime"])("публичная цель %s не доказывает основание дополнительного входа Domain", async subpath => {
  const f = await fixture()
  await Bun.write(join(f.domain, "package.json"), JSON.stringify({
    name: "@fixture/area", description: "Область значений",
    exports: {".": "./index.ts", [subpath]: "./value/index.ts"}, dependencies: {"@fixture/value": "workspace:*"},
  }))
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.validation.checks.filter(check => check.status === "failed")).toEqual([])
  expect(report.tests.find(point => point.label === "Цель протокольного входа")?.status).toBe("passed")
  expect(report.tests.find(point => point.label === "Основание внешнего протокола")?.status).toBe("todo")
  expect(report.tests.filter(point => point.status === "failed")).toEqual([])
}, 30_000)

test("входы Component не допускают вторую кодовую реализацию, но сохраняют ресурсный экспорт", async () => {
  const f = await fixture()
  await Bun.write(join(f.component, "theme.css"), ":root { --color: red }")
  await Bun.write(join(f.component, "package.json"), JSON.stringify({
    name: "@fixture/value", description: "Значение с ресурсом",
    exports: {".": "./index.ts", "./theme.css": "./theme.css"},
  }))
  const valid = await readScenario({path: scenario, props: {path: f.component}})
  expect(valid.exitCode, valid.stderr).toBe(0)
  expect(valid.tests.find(point => point.label === "Кодовый вход компонента")?.status).toBe("passed")
  expect(valid.tests.find(point => point.label === "Файлы ресурсов")?.status).toBe("passed")

  await mkdir(join(f.component, "extra"))
  await Bun.write(join(f.component, "extra/index.ts"), "export default 4")
  await Bun.write(join(f.component, "package.json"), JSON.stringify({
    name: "@fixture/value", description: "Вторая реализация",
    exports: {".": "./index.ts", "./extra": "./extra/index.ts"},
  }))
  const invalid = await readScenario({path: scenario, props: {path: f.component}})
  expect(invalid.tests.find(point => point.label === "Кодовый вход компонента")?.status).toBe("failed")
  expect(invalid.exitCode).not.toBe(0)
}, 30_000)

test("Domain без дополнительного входа не получает проверку чужого протокола", async () => {
  const f = await fixture()
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.tests.find(point => point.label === "Корневой API домена")?.status).toBe("passed")
  expect(report.tests.filter(point => point.status !== "passed" && !(point.status === "skipped" && point.skipReason))).toEqual([])
}, 30_000)

test.each(["relative", "absolute", "file"])("публичный вход другого пакета не разрешает файловый адрес %s", async kind => {
  const f = await fixture()
  const path = join(f.component, "index.ts")
  const address = kind === "relative" ? "./value/index.ts" : kind === "file" ? pathToFileURL(path).href : path
  await Bun.write(join(f.domain, "index.ts"), `export {default as Value} from ${JSON.stringify(address)}`)
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.tests.find(point => point.label === "Адреса зависимостей")?.status).toBe("failed")
}, 30_000)

test("относительный путь не обходит проверку объявленных зависимостей", async () => {
  const f = await fixture()
  await Bun.write(join(f.domain, "package.json"), JSON.stringify({
    name: "@fixture/area", description: "Область", exports: {".": "./index.ts"},
  }))
  await Bun.write(join(f.domain, "index.ts"), 'export {default as Value} from "./value/index.ts"')
  const report = await readScenario({path: scenario, props: {path: f.domain}})
  expect(report.tests.find(point => point.label === "Объявленные зависимости")?.status).toBe("failed")
}, 30_000)

test("свои helpers допустимы, но внутренний тип не скрывает относительный импорт другого пакета", async () => {
  const f = await fixture()
  await mkdir(join(f.component, "src"))
  await Bun.write(join(f.component, "src/value.ts"), 'export interface Value {value: number}')
  await Bun.write(join(f.component, "index.ts"), '/** Значение.\n@packageDocumentation\n*/\nimport type {Value} from "./src/value.ts"\nexport default function value() {const result: Value = {value: 3}\nreturn result}')
  const valid = await readScenario({path: scenario, props: {path: f.component}})
  expect(valid.tests.find(point => point.label === "Адреса зависимостей")?.status).toBe("passed")
  await Bun.write(join(f.domain, "contract.ts"), 'export interface Value {value: number}')
  await Bun.write(join(f.component, "src/value.ts"), 'export type {Value} from "../../archetypes/contract.ts"')
  const invalid = await readScenario({path: scenario, props: {path: f.component}})
  expect(invalid.tests.find(point => point.label === "Адреса зависимостей")?.status).toBe("failed")
  expect(invalid.tests.find(point => point.label === "Публичные владельцы")?.status).toBe("failed")
}, 30_000)
