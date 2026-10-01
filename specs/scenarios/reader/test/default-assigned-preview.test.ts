import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import readScenario from "@archetypes/scenario-reader"

const fixture = resolve(import.meta.dir, "fixture/default-assigned/spec")

describe("Default callable с собственными статическими полями", async () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-default-assigned-"))
  const counter = join(root, "calls.txt")
  const previous = process.env.STORYBOOK_DEFAULT_ASSIGNED_COUNTER
  writeFileSync(counter, "0")
  process.env.STORYBOOK_DEFAULT_ASSIGNED_COUNTER = counter
  afterAll(() => {
    if (previous === undefined) delete process.env.STORYBOOK_DEFAULT_ASSIGNED_COUNTER
    else process.env.STORYBOOK_DEFAULT_ASSIGNED_COUNTER = previous
    rmSync(root, {recursive: true, force: true})
  })
  const path = resolve(fixture, "scenario.spec.ts")
  const supported = await readScenario.supportsPreview({path})
  const report = await readScenario({path})

  test("Публичный callable распознан", () => {
    expect(supported, "Тип default export имеет call signature независимо от формы export assignment").toBeTrue()
    expect(report.validation.checks.find(check => check.rule === "single-invocation")?.status,
      "Вариант непосредственно вызывает публичную функцию ровно один раз"
    ).toBe("passed")
  })
  test("Результат одного исполнения", () => {
    expect(report.exitCode, report.stderr).toBe(0)
    expect(report.tests.map(point => point.status), "Настоящие проверки значения и статического поля пройдены").toEqual(["passed", "passed"])
    expect(readFileSync(counter, "utf8"), "Инспекция и подготовка preview не запускают функцию повторно").toBe("1")
    expect(report.calls.filter(call => call.name === "default" && call.module.endsWith("/default-assigned/index.ts")),
      "Trace связывает единственный прямой вызов с публичным default export"
    ).toHaveLength(1)
  })
  test("Представление использует тот же вызов", () => {
    expect(report.preview, "Preview построен из фактического вызова без новой оценки default export").toMatchObject({
      kind: "function",
      variants: [{calls: [{source: expect.stringContaining("double(")}]}],
    })
  })
})

test("Повторный вызов callable не создаёт preview", async () => {
  const path = resolve(fixture, "twice.spec.ts")
  const report = await readScenario({path})
  expect(report.validation.checks.find(check => check.rule === "single-invocation")?.status,
    "Два вызова одного публичного callable нарушают правило варианта"
  ).toBe("failed")
  expect(report.preview, "Неоднозначный результат не превращается в представление одного вызова").toBeUndefined()
  await expect(readScenario.supportsPreview({path}), "Статическое чтение также отклоняет повтор").rejects.toThrow("один вызов")
}, 30_000)

test("Реальный AppWeb получает default callable preview", async () => {
  const path = resolve(import.meta.dir, "../../../../app/web/spec/scenario.spec.ts")
  expect(await readScenario.supportsPreview({path}), "Публичный AppWeb default callable поддерживает native preview").toBeTrue()
  const report = await readScenario({path, variant: 0})
  expect(report.exitCode, report.stderr).toBe(0)
  expect(report.validation.checks.find(check => check.rule === "single-invocation")?.status,
    "Сценарий AppWeb остаётся оформлен как один вызов createWeb"
  ).toBe("passed")
  expect(report.preview?.kind, "AppWeb раскрывается как исполняемый function preview").toBe("function")
  const observed = report.calls.filter(call => call.name === "default" && call.module.endsWith("/app/web/index.ts"))
  expect(observed, "Reader сохранил один наблюдённый вызов AppWeb из варианта").toHaveLength(1)
  if (report.preview?.kind !== "function") throw new Error("Нет function preview для AppWeb")
  expect(report.preview.variants[0]?.calls.map(call => call.id),
    "Preview ссылается на trace ID того же вызова, не исполняя Web повторно"
  ).toEqual([observed[0]!.id])
}, 30_000)

test("Объектный default остаётся структурным представлением", async () => {
  const path = resolve(import.meta.dir, "../../../../tech/build/compiler/spec/scenario.spec.ts")
  expect(await readScenario.supportsPreview({path}),
    "Таблица операций Compiler не имеет call/construct signature и не получает исполняемый function preview"
  ).toBeFalse()
}, 30_000)
