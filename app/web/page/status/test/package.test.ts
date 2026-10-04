import {expect, test} from "bun:test"
import Status from "../index"

test("[PACKAGE-STATUS] отображает только опубликованные этапы StorybookPackageSession", () => {
  expect(Status.packageEvent("@fixture/components", "package.code-updated"))
    .toContain("Изменения обнаружены; подготовка следующей сборки")
  expect(Status.packageEvent("@fixture/components", "package.built"))
    .toContain("ожидание проверки и применения")
  expect(Status.packageEvent("@fixture/components", "package.activating"))
    .toContain("Проверка и применение")
  expect(Status.packageEvent("@fixture/components", "package.updated"))
    .toContain("ревизия готова")
  expect(Status.packageEvent("@fixture/components", "package.failed"))
    .toContain("Ошибка обработки")
  expect(Status.packageEvent("@fixture/components", "package.updated"))
    .not.toContain("@fixture/components")
})

test("[PACKAGE-STATUS] восстановленный snapshot не превращает built в applied", () => {
  expect(Status.packageBuild("@fixture/components", "queued")).toContain("Ожидание очереди сборки")
  expect(Status.packageBuild("@fixture/components", "compiling")).toContain("Сборка выполняется")
  expect(Status.packageBuild("@fixture/components", "building")).toContain("Проверка входов и ресурсов")
  expect(Status.packageBuild("@fixture/components", "built")).toContain("ожидание проверки и применения")
  expect(Status.packageBuild("@fixture/components", "failed")).toContain("Ошибка обработки")
  expect(Status.packageBuild("@fixture/components", "active")).toContain("Текущая ревизия готова")
})

test("[PACKAGE-STATUS] показывает наблюдаемое восстановление соединения", () => {
  expect(Status.connection("connecting")).toContain("Подключение")
  expect(Status.connection("connected")).toContain("установлено")
  expect(Status.connection("reconnected")).toContain("восстановлено")
  expect(Status.connection("disconnected")).toContain("потеряно")
})
