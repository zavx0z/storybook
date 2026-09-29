/**
Показывает и проверяет общие требования Package и применимые правила Repo,
Domain или Component. Один запуск служит проверкой, документацией и примером;
классификация выражена разделами и утверждениями этого же сценария.
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
  const entries = result.index.entries.filter(entry => entry.path === "." && entry.code && entry.status === "owned")
  const localCode = result.code.filter(source => source.exports.length > 0)
  const repo = result.repository.gitRoot === result.root
  const domain = !repo && result.packages.length > 0 && localCode.length === 0
  const component = !repo && entries.some(entry => result.code.some(source =>
    source.path === resolve(result.root, entry.target!) && source.exports.length > 0))

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

  /** @remarks Структурная роль проверяется после полного раскрытия exports; иначе сохраняется TODO полноты ниже. */
  describe.skipIf(result.index.unchecked.length > 0)("Классификация", () => {
    test("Структурная роль", () => {
      expect({root: result.root, repository: result.repository, packages: result.packages, code: result.code},
        "Repo находится в корне своей Git-истории. Внутри Repo Domain организует пакеты без собственной runtime реализации, Component предоставляет собственную реализацию. Подтверждение требует всех проверок применимого раздела, а не одного этого пункта.")
        .toSatisfy(() => Number(repo) + Number(domain) + Number(component) === 1)
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

  /** @remarks Repo проверяется только для пакета в точном корне собственной Git-истории. */
  describe.skipIf(!repo)("Repo", () => {
    test("Независимые репозитории", () => {
      expect(result.repository.nestedRepositories,
        "Другие самостоятельные Repo подключаются к Project, а не вкладываются в этот Repo").toEqual([])
    })
  })

  /** @remarks Domain применим к вложенному пакету, объединяющему части без собственной runtime реализации. */
  describe.skipIf(!domain)("Domain", () => {
    test("Принадлежность публичных входов", () => {
      expect(result.index.entries,
        "Кодовые подпути Domain прямо открывают публичные входы вложенных пакетов; корневой index может содержать обзор и типы")
        .toSatisfy(entries => entries.every(entry => !entry.code || entry.status === "forwarded" || entry.status === "blocked"
          || entry.status === "owned" && entry.path === "."))
    })
  })

  /** @remarks Component применим к вложенному пакету с собственной runtime реализацией в основном публичном входе. */
  describe.skipIf(!component)("Component", () => {
    test("Основная реализация", () => {
      expect(entries.map(entry => result.code.find(source => source.path === resolve(result.root, entry.target!))),
        "Каждая условная ветвь предоставляет одну основную runtime реализацию; type-only экспорты не считаются реализациями")
        .toSatisfy(sources => sources.every(source => source?.exports.length === 1))
    })
    test("Публичная граница", () => {
      expect(result.index.entries,
        "Дополнительные самостоятельные реализации получают собственные пакеты; Component публикует собственный основной кодовый вход")
        .toSatisfy(entries => entries.every(entry => !entry.code || entry.status === "blocked" || entry.path === "." && entry.status === "owned"))
    })
    test("Исполняемое использование", () => {
      expect(result.scenarios,
        "Компонент имеет один непосредственный сценарий использования публичного API; он исполняется обычным механизмом сценариев владельца")
        .toHaveLength(1)
    })
    test("Результат", () => {
      expect(entries,
        "Невизуальный результат описан выходным контрактом владельца; визуальный компонент возвращает JSX")
        .toSatisfy(entries => entries.every(entry => /\.[jt]sx$/u.test(entry.target!) || entry.output !== null))
    })
  })
})
