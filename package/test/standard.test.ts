import {afterAll, expect, test} from "bun:test"
import {cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve, sep} from "node:path"
import readScenario from "@storybook-specs-scenarios/reader"

const scenario = resolve(import.meta.dir, "../reader/spec/scenario.spec.ts")
const roots: string[] = []
afterAll(async () => {
  for (const root of roots) await rm(root, {recursive: true, force: true})
})

test.each([
  ["Domain", resolve(import.meta.dir, "../../specs")],
  ["Component", resolve(import.meta.dir, "../../component/spec/fixture/component")],
  ["Container", resolve(import.meta.dir, "../../container/spec/fixture/compose")],
] as const)("один сценарий проверяет %s и предоставляет те же данные представлениям", async (role, path) => {
  if (role === "Container") {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "package-container-")))
    roots.push(root)
    await cp(resolve(path, ".."), root, {
      recursive: true,
      filter: source => !source.split(sep).includes("node_modules"),
    })
    const manifests = [...new Bun.Glob("compose/**/package.json").scanSync({cwd: root, absolute: true})]
    await mkdir(resolve(root, "node_modules/@fixture"), {recursive: true})
    for (const file of manifests) {
      const manifest = await Bun.file(file).json()
      await symlink(resolve(file, ".."), resolve(root, "node_modules", manifest.name))
    }
    path = resolve(root, "compose")
  }
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.exitCode, report.stderr).toBe(0)
  expect(report.validation.checks.filter(check => check.status === "failed")).toEqual([])
  expect(report.tests.filter(point => point.status !== "passed" && !(point.status === "skipped" && point.skipReason))
    .map(point => ({label: point.label, status: point.status})),
    "Выбранные примеры не объявляют протокольные подпути; неприменимый TODO не регистрируется")
    .toEqual([])
  expect(report.calls.filter(call => call.name === "default")).toHaveLength(1)
  expect(report.preview?.kind).toBe("function")
  expect(report.groups.some(group => group.label === role)).toBeTrue()
}, 30_000)

test("Repo без собственного API сохраняет пустую карту экспортов без фиктивного входа", async () => {
  const path = resolve(import.meta.dir, "../..")
  const manifest = await Bun.file(resolve(path, "package.json")).json()
  expect(manifest.exports).toBeUndefined()
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.groups.some(group => group.label === "Repo")).toBeTrue()
  expect(report.tests.find(point => point.label === "Экспорты репозитория")?.status).toBe("passed")
  expect(report.tests.find(point => point.label === "Прочитанная карта")?.status).toBe("passed")
}, 30_000)

test("подтверждение роли не скрывает провал последующего требования Component", async () => {
  const path = await realpath(await mkdtemp(resolve(tmpdir(), "package-standard-")))
  roots.push(path)
  await cp(resolve(import.meta.dir, "../../component/spec/fixture/component"), path, {recursive: true})
  await rm(resolve(path, "contract/output.ts"))
  // Файловая проверка не исполняет component: импорт отсутствующего типа не маскирует нарушение.
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.tests.find(point => point.label === "Структурная роль")?.status).toBe("passed")
  expect(report.tests.find(point => point.label === "Результат")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)

test("отсутствие роли остаётся нарушением с наблюдаемыми данными, а не успехом пустого набора", async () => {
  const path = await realpath(await mkdtemp(resolve(tmpdir(), "package-unclassified-")))
  roots.push(path)
  await writeFile(resolve(path, "package.json"), JSON.stringify({name: "@fixture/empty", description: "Пустой пакет", exports: {".": "./index.ts"}}))
  await writeFile(resolve(path, "index.ts"), "/** Пустой пакет. @packageDocumentation */\nexport {}")
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.tests.find(point => point.label === "Структурная роль")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)

test("вложенный Component не повторяет общую среду разработки Repo", async () => {
  const path = await realpath(await mkdtemp(resolve(tmpdir(), "package-repeated-env-")))
  roots.push(path)
  await cp(resolve(import.meta.dir, "../../component/spec/fixture/component"), path, {recursive: true})
  const manifestPath = resolve(path, "package.json")
  const manifest = await Bun.file(manifestPath).json()
  await writeFile(manifestPath, JSON.stringify({...manifest, engines: {bun: "1.4.x"}}))
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.tests.find(point => point.label === "Общая среда Bun только у Repo")?.status,
    "Повторное engines.bun у Component нарушает единое владение средой Repo")
    .toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)
