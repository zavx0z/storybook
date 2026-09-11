import {expect, test} from "bun:test"
import {
  buildProgressStatus,
  catalogProgressStatus,
  readBuildProgress,
  readCatalogProgress,
  readSharedCacheProgress,
  sharedCacheProgressStatus,
} from "./build-progress.ts"

test("этапы очереди, компиляции и результата различаются в панели", () => {
  const common = {type: "build.progress", at: new Date().toISOString(), operationId: "build-1", packageId: "@fixture/a", generation: 1, owner: "check", phase: "bundle"}
  expect(buildProgressStatus(readBuildProgress({...common, state: "queued", reason: "input-changed"})!)).toContain("Ожидание очереди сборки; изменились входы")
  expect(buildProgressStatus(readBuildProgress({...common, state: "running"})!)).toContain("Компиляция интерфейса")
  expect(buildProgressStatus(readBuildProgress({...common, state: "completed", outcome: "completed"})!)).toContain("ожидание проверки и применения")
  expect(buildProgressStatus(readBuildProgress({...common, state: "completed", outcome: "timed-out"})!)).toContain("Превышен срок")
  expect(buildProgressStatus(readBuildProgress({...common, state: "completed", outcome: "canceled"})!)).toContain("отменена")
  expect(buildProgressStatus(readBuildProgress({...common, state: "completed", outcome: "failed"})!)).toContain("Ошибка обработки")
  expect(readBuildProgress({...common, state: "running", phase: "invented"})).toBeNull()
  expect(readBuildProgress({...common, state: "completed", outcome: "invented"})).toBeNull()
})

test("catalog progress выводит только фактические границы обновления", () => {
  expect(catalogProgressStatus(readCatalogProgress({type: "catalog.progress", state: "running"})!))
    .toContain("Поиск пакетов")
  expect(catalogProgressStatus(readCatalogProgress({type: "catalog.progress", state: "completed"})!))
    .toContain("Структура обновлена")
  expect(catalogProgressStatus(readCatalogProgress({type: "catalog.progress", state: "failed"})!))
    .toContain("Ошибка")
  expect(readCatalogProgress({type: "catalog.progress", state: "invented"})).toBeNull()
})

test("shared cache progress не создаёт фиктивную scheduler job", () => {
  expect(sharedCacheProgressStatus(readSharedCacheProgress({
    type: "shared.cache-progress",
    state: "started",
  })!)).toContain("Проверка текущей сборки")
  expect(sharedCacheProgressStatus(readSharedCacheProgress({
    type: "shared.cache-progress",
    state: "completed",
    hit: true,
  })!)).toContain("подтверждена")
  expect(readSharedCacheProgress({type: "shared.cache-progress", state: "completed"})).toBeNull()
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
    cache: "Проверка сохранённой сборки",
    fingerprint: "Проверка входов и ресурсов",
    resources: "Проверка и публикация ресурсов",
    exports: "Проверка экспортов",
    bundle: "Компиляция интерфейса",
    kernel: "Сборка общих модулей",
    host: "Сборка оболочки Storybook",
    "protocol-build": "Компиляция проверки протокола",
    "protocol-run": "Проверка протокола",
    publish: "Локальная публикация ревизии",
  }
  for (const [phase, label] of Object.entries(expected)) {
    expect(buildProgressStatus(readBuildProgress({...common, phase})!)).toContain(label)
  }
})
