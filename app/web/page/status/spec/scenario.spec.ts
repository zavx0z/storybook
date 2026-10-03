import {expect, test} from "bun:test"
import Status from "../index"

test("этапы очереди, компиляции и результата различаются в панели", () => {
  const common = {type: "build.progress", at: new Date().toISOString(), operationId: "build-1", packageId: "@fixture/a", generation: 1, owner: "check", phase: "bundle"}
  expect(Status.build(Status.readBuild({...common, state: "queued", reason: "input-changed"})!)).toContain("Ожидание очереди сборки; изменились входы")
  expect(Status.build(Status.readBuild({...common, state: "running"})!)).toContain("Компиляция интерфейса")
  expect(Status.build(Status.readBuild({...common, state: "completed", outcome: "completed"})!)).toContain("ожидание проверки и применения")
  expect(Status.build(Status.readBuild({...common, state: "completed", outcome: "timed-out"})!)).toContain("Превышен срок")
  expect(Status.build(Status.readBuild({...common, state: "completed", outcome: "canceled"})!)).toContain("отменена")
  expect(Status.build(Status.readBuild({...common, state: "completed", outcome: "failed"})!)).toContain("Ошибка обработки")
  expect(Status.build(Status.readBuild({...common, state: "running", phase: "verification"})!)).toContain("Проверка стандарта пакета")
  expect(Status.readBuild({...common, state: "running", phase: "invented"})).toBeNull()
  expect(Status.readBuild({...common, state: "completed", outcome: "invented"})).toBeNull()
})

test("catalog progress выводит только фактические границы обновления", () => {
  expect(Status.catalog(Status.readCatalog({type: "catalog.progress", state: "running"})!))
    .toContain("Поиск пакетов")
  expect(Status.catalog(Status.readCatalog({type: "catalog.progress", state: "completed"})!))
    .toContain("Структура обновлена")
  expect(Status.catalog(Status.readCatalog({type: "catalog.progress", state: "failed"})!))
    .toContain("Ошибка")
  expect(Status.readCatalog({type: "catalog.progress", state: "invented"})).toBeNull()
})


test("каждая реальная фаза сборки получает отдельную короткую строку", () => {
  const common = {
    type: "build.progress",
    at: new Date().toISOString(),
    operationId: "build-2",
    packageId: "@fixture/a",
    generation: 1,
    owner: "check",
    state: "running",
  }
  const expected = {
    admission: "Подготовка компилятора",
    discovery: "Поиск и разбор каталога",
    resources: "Проверка и публикация ресурсов",
    exports: "Проверка экспортов",
    bundle: "Компиляция интерфейса",
    kernel: "Сборка общих модулей",
    host: "Сборка оболочки Storybook",
    publish: "Локальная публикация ревизии",
  }
  for (const [phase, label] of Object.entries(expected)) {
    expect(Status.build(Status.readBuild({...common, phase})!)).toContain(label)
  }
})
