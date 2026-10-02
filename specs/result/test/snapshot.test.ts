import {expect, test} from "bun:test"
import {statSync} from "node:fs"
import {resolve} from "node:path"
import readSpec from "@archetypes/spec-reader"

test("исполнение спецификации только читает полный JSON-эталон", async () => {
  const path = resolve(import.meta.dir, "../spec/__snapshots__/scenario.spec.json")
  const before = statSync(path, {bigint: true})
  const content = await Bun.file(path).text()
  const report = await readSpec({path: resolve(import.meta.dir, "..")})
  expect(report?.scenario?.exitCode, "Проверки эталона действительно выполнены").toBe(0)
  const after = statSync(path, {bigint: true})
  expect({mtime: after.mtimeNs, ctime: after.ctimeNs, size: after.size},
    "Чтение сценария не переписывает свой вход и не отменяет свидетельство сборки").toEqual({
    mtime: before.mtimeNs, ctime: before.ctimeNs, size: before.size,
  })
  expect(await Bun.file(path).text(), "Все ожидаемые данные сохраняются без обновления эталона").toBe(content)
}, 60_000)
