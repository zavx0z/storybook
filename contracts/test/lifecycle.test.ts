import {expect, test} from "bun:test"
import {rm, symlink} from "node:fs/promises"
import {resolve} from "node:path"
import readContract from "@archetypes/contracts"
import {createFixture} from "./fixture"

test("Следующее чтение отражает изменение и удаление определения", async () => {
  const fixture = await createFixture()
  try {
    const source = resolve(fixture.root, "contract/value.ts")
    const first = await readContract({path: fixture.root})
    await fixture.write("contract/value.ts", 'export interface Request {readonly value: number\nreadonly step?: number\nreadonly unit: "px"}\n')
    const updated = await readContract({path: fixture.root})
    expect(updated.diagnostics, "Новое определение читается согласованно после изменения").toEqual([])
    expect(updated.sources.find(value => value.path === source)?.digest,
      "Повторное чтение не сохраняет digest старого snapshot").not.toBe(first.sources.find(value => value.path === source)?.digest)
    expect(updated.entries[0]?.namespaces[0]?.roles.find(role => role.name === "Input")?.fields.map(value => value.name),
      "Новая собственная форма содержит добавленное поле unit").toEqual(["value", "step", "unit"])
    await rm(source)
    const removed = await readContract({path: fixture.root})
    expect(removed.diagnostics.some(value => value.code === "unresolved-type" || value.code === "typescript-2307"),
      "Удалённый источник остаётся неразрешённой зависимостью вместо старой формы").toBeTrue()
    expect(removed.sources.map(value => value.path), "Удалённый файл не публикуется как успешно прочитанный источник").not.toContain(source)
    expect(removed.entries[0]?.namespaces[0]?.roles.find(role => role.name === "Input")?.fields.map(value => value.name),
      "Результат удаления не возвращает устаревшие поля Request").toEqual([])
  } finally {
    await fixture.close()
  }
})

test("Игнорируемый источник не выдаётся за доступный контракт", async () => {
  const fixture = await createFixture()
  try {
    await fixture.write(".gitignore", "contract/\n")
    const result = await readContract({path: fixture.root})
    expect(result.diagnostics, "Контракт, скрытый правилами владельца, сохраняет явное нарушение доступности")
      .toContainEqual(expect.objectContaining({code: "ignored-source", path: resolve(fixture.root, "contract/index.ts")}))
  } finally {
    await fixture.close()
  }
})

test("Символическая ссылка не заменяет собственный исходник", async () => {
  const fixture = await createFixture()
  try {
    const source = resolve(fixture.root, "contract/value.ts")
    const target = await fixture.write("contract/linked-value.ts", 'export interface Request {value: number\nstep?: number}\n')
    await rm(source)
    await symlink(target, source)
    await expect(readContract({path: fixture.root}), "Читатель отклоняет подмену физического файла; ссылка целиком находится в принадлежащей тесту директории")
      .rejects.toThrow()
  } finally {
    await fixture.close()
  }
})
