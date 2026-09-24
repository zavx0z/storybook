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
      expect(result.packageJson.label, "Название объясняет предмет пакета человеку").toMatch(/\S/u)
    })
    test("Ответственность", () => {
      expect(result.packageJson.description, "Описание сообщает, для чего существует пакет").toMatch(/\S/u)
      expect(result.readme.content, "README раскрывает назначение и границы ответственности пакета").toMatch(/\S/u)
    })
  })

  describe("Публичные входы", () => {
    test("Объявленный состав", () => {
      expect(result.packageJson.exports, "Публичные пути объявлены самим пакетом").toBeObject()
      expect(result.index.entries, "Каждый раскрытый вход показывает файл, условия и доступные контракты").toBeArray()
    })
    test.todoIf(result.index.unchecked.length > 0)("Полнота раскрытия exports", () => {
      expect(result.index.unchecked, "Все объявления этого примера входят в область файловой проверки").toEqual([])
    })
    test("Принадлежность файлов", () => {
      const unavailable = result.index.entries.filter(entry => entry.status !== "owned" && entry.status !== "blocked")
      expect(unavailable, "Каждый открытый публичный путь ведёт к существующему файлу своего пакета").toEqual([])
    })
    test("Вход самостоятельной сущности", () => {
      const internal = result.index.entries.filter(entry => entry.code && !entry.entrypoint)
      expect(internal, "Кодовый экспорт ведёт к index.ts или index.tsx сущности; служебные файлы не публикуются напрямую").toEqual([])
    })
    test("Отсутствие псевдонимов", () => {
      const aliases = result.index.entries.filter(entry => entry.code && entry.target !== null && result.index.entries.some(other =>
        other.path !== entry.path && other.target !== null && resolve(props.path, other.target) === resolve(props.path, entry.target!),
      ))
      expect(aliases, "Одна кодовая сущность имеет один публичный путь; условия одного пути не являются псевдонимами").toEqual([])
    })
  })

  describe("Контракты", () => {
    test("Вход и результат", () => {
      const missing = result.index.entries.filter(entry => entry.code && entry.entrypoint && (entry.input === null || entry.output === null))
      expect(missing, "У каждого входа примера есть contract/input.ts и contract/output.ts; наличие файла ещё не подтверждает содержание типов").toEqual([])
    })
    test.todo("Смысловая полнота контрактов и единственная основная исполняемая сущность", () => {
      expect(undefined, "Нужно проверить содержание типов и экспортов исходника; наличие файлов этого не доказывает").toBeDefined()
    })
  })

  describe("Поведение и состояние", () => {
    test.todo("Компонент владеет порядком pipeline, состоянием, методами и подписками", () => {
      expect(undefined, "Время жизни состояния и освобождение подписок требуют отдельного поведенческого примера").toBeDefined()
    })
    test.todo("Функции обогащения изменяют только данные переданного объекта $, не добавляя методы и подписки", () => {
      expect(undefined, "Размещение мутирующих функций и Store ещё уточняется; файловое чтение не проверяет эффекты").toBeDefined()
    })
  })
})
