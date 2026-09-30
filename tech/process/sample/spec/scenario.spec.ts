import {describe, expect, test} from "bun:test"
import ProcessResourceSampler from "@process/sample"

describe.each([
  {name: "Системный снимок по запросу"},
])("$name", () => {
  const sampler = new ProcessResourceSampler()
  const rows = sampler.sample()

  test("Таблица процессов", () => {
    expect(Array.isArray(rows), "Один запрос возвращает строки системного снимка; недоступный источник возвращает пустую таблицу").toBeTrue()
    expect(Object.isFrozen(rows), "Состав прочитанного снимка защищён от изменения").toBeTrue()
  })
  test("Идентичность процессов", () => {
    expect(rows.every(row => Number.isSafeInteger(row.pid) && row.pid > 0 && Number.isSafeInteger(row.parentPid) && row.parentPid >= 0), "Строка связывает положительный PID с неотрицательным PID родителя").toBeTrue()
  })
  test("Полный состав строки", () => {
    expect(rows.every(row => Object.keys(row).join(",") === "pid,parentPid,cpuPercent,rssBytes,startedAt"), "Снимок раскрывает только идентичность, ресурсы и время старта, без команды процесса").toBeTrue()
    expect(rows.every(row => Object.isFrozen(row)), "Каждая системная строка неизменяема").toBeTrue()
  })
  test("Единицы ресурсов", () => {
    expect(rows.every(row => row.cpuPercent === null || Number.isFinite(row.cpuPercent) && row.cpuPercent >= 0), "CPU содержит системное значение %CPU либо null при отсутствии измерения").toBeTrue()
    expect(rows.every(row => row.rssBytes === null || Number.isFinite(row.rssBytes) && row.rssBytes >= 0), "RSS содержит байты resident set либо null при отсутствии измерения").toBeTrue()
  })
  test("Метка старта", () => {
    expect(rows.every(row => row.startedAt === null || typeof row.startedAt === "string" && row.startedAt.length > 0), "Системная метка старта сохраняется для защиты привязки от повторного использования PID").toBeTrue()
  })
  /** @remarks При недоступном `ps` пустой снимок сохраняет отсутствие данных; проверка присутствия процессов к нему неприменима. */
  describe.skipIf(rows.length === 0)("Доступный системный источник", () => {
    test("Текущий процесс", () => {
      expect(rows.some(row => row.pid === process.pid), "Доступный системный снимок включает процесс, запросивший измерение").toBeTrue()
    })
  })
})
