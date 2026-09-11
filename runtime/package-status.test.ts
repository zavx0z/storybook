import {expect, test} from "bun:test"
import {packageBuildStatus, packageEventStatus, storybookConnectionStatus} from "./package-status.ts"

test("[PACKAGE-STATUS] отображает только опубликованные этапы PackageSession", () => {
  expect(packageEventStatus("@fixture/components", "package.code-updated"))
    .toContain("Изменения обнаружены; подготовка следующей сборки")
  expect(packageEventStatus("@fixture/components", "package.built"))
    .toContain("ожидание проверки и применения")
  expect(packageEventStatus("@fixture/components", "package.activating"))
    .toContain("Проверка и применение")
  expect(packageEventStatus("@fixture/components", "package.updated"))
    .toContain("ревизия готова")
  expect(packageEventStatus("@fixture/components", "package.failed"))
    .toContain("Ошибка обработки")
  expect(packageEventStatus("@fixture/components", "package.updated"))
    .not.toContain("@fixture/components")
})

test("[PACKAGE-STATUS] восстановленный snapshot не превращает built в applied", () => {
  expect(packageBuildStatus("@fixture/components", "queued")).toContain("Ожидание очереди сборки")
  expect(packageBuildStatus("@fixture/components", "compiling")).toContain("Сборка выполняется")
  expect(packageBuildStatus("@fixture/components", "building")).toContain("Проверка входов и ресурсов")
  expect(packageBuildStatus("@fixture/components", "built")).toContain("ожидание проверки и применения")
  expect(packageBuildStatus("@fixture/components", "failed")).toContain("Ошибка обработки")
  expect(packageBuildStatus("@fixture/components", "active")).toContain("Текущая ревизия готова")
})

test("[PACKAGE-STATUS] показывает наблюдаемое восстановление соединения", () => {
  expect(storybookConnectionStatus("connecting")).toContain("Подключение")
  expect(storybookConnectionStatus("connected")).toContain("установлено")
  expect(storybookConnectionStatus("reconnected")).toContain("восстановлено")
  expect(storybookConnectionStatus("disconnected")).toContain("потеряно")
})
