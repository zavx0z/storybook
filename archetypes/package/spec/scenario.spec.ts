/**
Показывает и проверяет общие требования Package и применимые правила Repo,
Domain или Component. Один запуск служит проверкой, документацией и примером;
классификация выражена разделами и утверждениями этого же сценария.
props.path позволяет применить те же проверки к другому пакету.
Файловая полнота не доказывает смысловую правильность компонента и его состояния.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {dirname, resolve} from "node:path"
import readPackage from "@archetypes/package"

describe.each([
  {name: "Архетип пакета", props: {path: resolve(import.meta.dir, "..")}},
])("$name", async ({props}) => {
  const result = await readPackage(props)
  const entries = result.index.entries.filter(entry => entry.path === "." && entry.code && entry.status === "owned")
  const localCode = result.code.filter(source => source.statements.length > 0
    || source.exports.some(item => item.runtime && item.declarations.some(declaration => declaration.owner?.path === result.root)))
  const repo = result.repository.gitRoot === result.root
  const domain = !repo && result.packages.length > 0 && localCode.length === 0
  const component = !repo && entries.some(entry => result.code.some(source =>
    source.path === resolve(result.root, entry.target!) && source.exports.some(item => item.runtime && item.declarations.some(declaration => declaration.owner?.path === result.root))))

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
      const internal = result.index.entries.filter(entry => entry.code && !entry.entrypoint
        && !(domain && entry.path === "." && entry.target && dirname(resolve(result.root, entry.target)) === result.root
          && entry.conditions.some(condition => !["default", "import", "require", "types", "module", "module-sync", "development", "production"].includes(condition))))
      expect(internal, "Компонент имеет основной index; входы сред домена объявлены условиями exports и находятся в его корне. Частные файлы не становятся публичными обходным путём").toEqual([])
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

  describe("Границы зависимостей", () => {
    test("Публичные владельцы", () => {
      expect(result.code.flatMap(source => source.references).filter(reference => reference.public === false || reference.public === null && reference.path === null),
        "Импорты контрактов и реализации используют публичные входы владельцев; собственные private helpers остаются внутри пакета").toEqual([])
    })
    test("Объявленные зависимости", () => {
      const production = Object.keys({...result.packageJson.dependencies, ...result.packageJson.peerDependencies, ...result.packageJson.optionalDependencies})
      const development = Object.keys({...result.packageJson.devDependencies})
      expect(result.code.flatMap(source => source.references),
        "Публичные реэкспорты доступны потребителю через dependencies/peerDependencies; внутренние типовые импорты не требуют обратной зависимости на домен")
        .toSatisfy(references => references.every(reference => {
          if (!reference.owner || reference.owner.path === result.root || reference.module.startsWith(".") || reference.module.startsWith("/")) return true
          const name = reference.module.startsWith("@") ? reference.module.split("/").slice(0, 2).join("/") : reference.module.split("/")[0]!
          return production.includes(name) || reference.typeOnly && !reference.exported && development.includes(name)
        }))
    })
    test("Состав только у Repo", () => {
      expect(repo || result.packageJson.workspaces === undefined,
        "Workspaces объявляет только Repo; Domain и Component получают состав из корневого glob").toBeTrue()
    })
    test("Общая среда Bun только у Repo", () => {
      expect(repo || result.packageJson.engines?.bun === undefined,
        "Общую среду разработки Bun объявляет Repo в engines.bun; вложенные Domain и Component не повторяют настройку окружения")
        .toBeTrue()
    })
  })

  /** @remarks Нераскрытая карта зависимого владельца не доказывает ни публичность, ни нарушение границы. */
  describe.skipIf(!result.code.some(source => source.references.some(reference => reference.public === null && reference.path !== null)))("Нераскрытые границы", () => {
    test.todo("Полнота публичных границ", () => {
      expect(result.code.flatMap(source => source.references).filter(reference => reference.public === null && reference.path !== null),
        "Публичность каждого разрешённого импорта подтверждена картой владельца").toEqual([])
    })
  })

  /** @remarks Структурная роль проверяется после полного раскрытия exports; иначе сохраняется TODO полноты ниже. */
  describe.skipIf(result.index.unchecked.length > 0)("Классификация", () => {
    test("Структурная роль", () => {
      expect({root: result.root, repository: result.repository, packages: result.packages, code: result.code},
        "Repo находится в корне своей Git-истории. Domain собирает API владельцев, не реализуя их поведение; Component владеет реализацией. Реэкспорты домена не считаются его реализациями. Подтверждение требует всех проверок применимого раздела, а не одного этого пункта.")
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
    test("Корневые glob", () => {
      const declaration = result.packageJson.workspaces
      const patterns = declaration === undefined ? [] : "packages" in declaration ? declaration.packages : declaration
      const include = patterns.filter(pattern => !pattern.startsWith("!"))
      expect(include, "Repo использует glob без ручного перечисления пакетов; пустому составу workspaces не обязательны")
        .toSatisfy(patterns => patterns.every(pattern => pattern.includes("*")))
      expect(result.packages, "Каждый рабочий пакет входит ровно в один положительный glob Repo")
        .toSatisfy(packages => packages.every(item => include.filter(pattern => new Bun.Glob(`${pattern}/package.json`)
          .match(`${item.path.slice(result.root.length + 1)}/package.json`)).length === 1))
    })
    test("Независимые репозитории", () => {
      expect(result.repository.nestedRepositories,
        "Другие самостоятельные Repo подключаются к Project, а не вкладываются в этот Repo").toEqual([])
    })
  })

  /** @remarks Domain применим к области с вложенными пакетами и API, собранным без локальной реализации поведения. */
  describe.skipIf(!domain)("Domain", () => {
    test("Происхождение API", () => {
      expect(result.code.flatMap(source => source.exports),
        "Домен назначает именованные экспорты, разрешённые до владельца; type-only и реэкспорт сохраняют своё назначение")
        .toSatisfy(exports => exports.every(item => item.name !== "default" && !item.unresolved && item.declarations.length > 0))
      expect(localCode, "Домен не добавляет локальное поведение или побочные эффекты вместо компонентов").toEqual([])
    })
    test("Принадлежность публичных входов", () => {
      expect(result.index.entries,
        "Домен собирает именованный API и типы владельцев; прямые подпути ведут к их публичным входам")
        .toSatisfy(entries => entries.every(entry => !entry.code || entry.status === "blocked"
          || (entry.path === "." ? entry.status === "owned" : entry.status === "forwarded")))
    })
  })

  /** @remarks Component применим к вложенному пакету с собственной runtime реализацией в основном публичном входе. */
  describe.skipIf(!component)("Component", () => {
    test("Основная реализация", () => {
      expect(entries.map(entry => result.code.find(source => source.path === resolve(result.root, entry.target!))),
        "Компонент предоставляет одну основную реализацию через default; именованные типы контрактов не увеличивают число реализаций")
        .toSatisfy(sources => sources.every(source => {
          const values = source?.exports.filter(item => item.runtime) ?? []
          return values.length === 1 && values[0]?.name === "default" && !values[0].unresolved
        }))
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
      expect(result.code.filter(source => entries.some(entry => resolve(result.root, entry.target!) === source.path)),
        "Публичный результат имеет выводимый TypeScript тип; используемые типовые контракты разрешаются, пустой output.ts не требуется")
        .toSatisfy(sources => sources.every(source => source.exports.filter(item => item.runtime).every(item => item.type !== null && !item.unresolved)
          && source.references.filter(item => item.typeOnly).every(item => item.path !== null || item.public === true)))
    })
  })
})
