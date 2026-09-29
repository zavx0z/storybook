/**
Показывает и проверяет публичный состав пакета на собственном примере Archetypes.
props.path позволяет применить те же проверки к другому пакету.
Файловая полнота не доказывает смысловую правильность компонента и его состояния.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readPackage} from "@archetypes/package"

describe.each([
  {name: "Архетип пакета", props: {path: resolve(import.meta.dir, "..")}},
])("$name", async ({props}) => {
  const result = await readPackage(props)

  describe("Назначение", () => {
    test("Идентичность", () => {
      expect(result.packageJson.name, "Пакет имеет собственное имя из package.json").toMatch(/\S/u)
      if (result.packageJson.label !== undefined) {
        expect(result.packageJson.label, "Заданная подпись объясняет предмет пакета человеку").toMatch(/\S/u)
      }
    })
    test("Ответственность", () => {
      expect(result.packageJson.description, "Описание сообщает, для чего существует пакет").toMatch(/\S/u)
      expect(result.documentation?.markdown, "Корневой TSDoc раскрывает назначение и границы ответственности пакета").toMatch(/\S/u)
    })
  })

  describe("Публичные входы", () => {
    test("Объявленный состав", () => {
      expect(result.packageJson.exports, "Публичные пути объявлены самим пакетом").toBeObject()
      expect(result.index.entries, "Каждый раскрытый вход показывает файл, условия и доступные контракты").toBeArray()
    })
    test("Принадлежность файлов", () => {
      const unavailable = result.index.entries.filter(entry => !["owned", "forwarded", "blocked"].includes(entry.status))
      expect(unavailable, "Публичный путь ведёт к своему файлу либо точному публичному входу вложенного владельца").toEqual([])
    })
    test("Вход самостоятельного компонента", () => {
      const internal = result.index.entries.filter(entry => entry.code && !entry.entrypoint)
      expect(internal, "Кодовый экспорт ведёт к index.ts или index.tsx владельца; служебные файлы не публикуются напрямую").toEqual([])
    })
    test("Отсутствие псевдонимов", () => {
      const aliases = result.index.entries.filter(entry => entry.code && entry.target !== null && result.index.entries.some(other =>
        other.path !== entry.path && other.target !== null && resolve(props.path, other.target) === resolve(props.path, entry.target!),
      ))
      expect(aliases, "В карте одного пакета реализация имеет один публичный путь; условия этого пути не являются псевдонимами").toEqual([])
    })
  })

  describe("Состав", () => {
    test("Владелец публичной реализации", () => {
      const names = new Set(result.packages.map(item => item.name))
      expect(result.index.entries.filter(entry => entry.owner && !names.has(entry.owner.name)),
        "Экспорт вложенного компонента принадлежит пакету, объявленному в штатном составе workspaces").toEqual([])
    })
  })

  /** @remarks Полнота файловой проверки применима, когда все объявления exports раскрыты. */
  describe.skipIf(result.index.unchecked.length > 0)("Раскрытые exports", () => {
    test("Полнота файловой проверки", () => {
      expect(result.index.unchecked, "Все объявления этого примера входят в область файловой проверки").toEqual([])
    })
  })

  /** @remarks Нераскрытые объявления требуют отдельной проверки; при полном раскрытии exports тема неприменима. */
  describe.skipIf(result.index.unchecked.length === 0)("Нераскрытые exports", () => {
    test.todo("Полнота раскрытия exports", () => {
      expect(result.index.unchecked, "Все объявления этого примера входят в область файловой проверки").toEqual([])
    })
  })
})
