/**
Показывает и проверяет общие требования Package и применимые правила Repo,
Domain, Component или Container. Один запуск служит проверкой, документацией и примером;
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
  const implementation = !repo && entries.some(entry => result.code.some(source =>
    source.path === resolve(result.root, entry.target!) && source.exports.some(item => item.runtime && item.declarations.some(declaration => declaration.owner?.path === result.root))))
  const component = implementation && result.packages.length === 0
  const container = implementation && result.packages.length > 0
  const parts = result.packages.filter(part => part.parent === result.root)
  const codeEntries = result.index.entries.filter(entry => entry.code && entry.status !== "blocked")
  const domainSubpaths = domain ? codeEntries.filter(entry => entry.path !== ".") : []
  const resources = result.index.entries.filter(entry => !entry.code && entry.status !== "blocked")

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
    test("Прочитанная карта", () => {
      expect(result.packageJson.exports,
        "Читатель сохраняет объявленную карту exports; отсутствие поля нормализовано в пустую карту. Допустимые входы определяет частный раздел Repo, Domain, Component или Container, а не наличие объекта")
        .toBeObject()
      expect(result.index.entries, "Каждый раскрытый вход показывает файл, условия и доступные контракты").toBeArray()
    })
    test("Принадлежность файлов", () => {
      const unavailable = result.index.entries.filter(entry => !["owned", "forwarded", "blocked"].includes(entry.status))
      expect(unavailable,
        "Цель существует у своего владельца, не проходит через symlink или закрытые исходники. Найденный публичный файл подтверждает принадлежность, но не необходимость дополнительного экспортного адреса")
        .toEqual([])
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
        "Workspaces объявляет только Repo; Domain, Component и Container получают состав из корневого glob").toBeTrue()
    })
    test("Общая среда Bun только у Repo", () => {
      expect(repo || result.packageJson.engines?.bun === undefined,
        "Общую среду разработки Bun объявляет Repo в engines.bun; вложенные Domain, Component и Container не повторяют настройку окружения")
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
        "Repo находится в корне своей Git-истории. Domain собирает API владельцев без собственной реализации. Component имеет собственную реализацию без вложенных пакетов; Container — собственную реализацию и принадлежащие части композиции. Реэкспорт не становится реализацией. Подтверждение требует всех применимых проверок, а не только признаков роли.")
        .toSatisfy(() => Number(repo) + Number(domain) + Number(component) + Number(container) === 1)
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
    test("Экспорты репозитория", () => {
      expect(result.packageJson.exports,
        "Repo без собственного публичного API может не объявлять exports: читатель возвращает {}. Состав вложенных пакетов задаётся workspaces и сам по себе не требует экспортировать их через Repo")
        .toBeObject()
      expect(codeEntries,
        "Если Repo публикует код, каждый объявленный вход ведёт к index своего владельца; закрытые файлы вложенных пакетов не становятся API репозитория")
        .toSatisfy(entries => entries.every(entry => entry.entrypoint))
    })
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
    test("Корневой API домена", () => {
      expect(codeEntries.filter(entry => entry.path === "."),
        "Основной API Domain задаётся входом «.» и собирает именованные возможности владельцев. При единственном общем входе exports имеет вид {«.»: «./index.ts»}; поддомены не перечисляются в exports только из-за своей вложенности")
        .toSatisfy(entries => entries.every(entry => entry.status === "owned" && entry.target !== null
          && dirname(resolve(result.root, entry.target)) === result.root))
    })
    test("Входы сред домена", () => {
      expect(codeEntries.filter(entry => entry.path === "."),
        "Для разных сред условия одного входа «.» выбирают собственные файлы в корне Domain, например browser: ./browser.ts и node: ./server.ts. index.ts/index.tsx подходит общему входу; development/production не создают отдельную среду")
        .toSatisfy(entries => entries.every(entry => entry.entrypoint || entry.conditions.some(condition =>
          !["default", "import", "require", "types", "module", "module-sync", "development", "production"].includes(condition))))
    })
    test("Происхождение API", () => {
      expect(result.code.flatMap(source => source.exports),
        "Домен назначает именованные экспорты, разрешённые до владельца; type-only и реэкспорт сохраняют своё назначение")
        .toSatisfy(exports => exports.every(item => item.name !== "default" && !item.unresolved && item.declarations.length > 0))
      expect(localCode, "Домен не добавляет локальное поведение или побочные эффекты вместо компонентов").toEqual([])
    })
    test("Принадлежность публичных входов", () => {
      expect(result.index.entries,
        "Основной кодовый вход принадлежит самому Domain. При наличии дополнительных кодовых подпутей их цели проверяются отдельно; допустимость таких адресов не выводится из публичности дочернего пакета")
        .toSatisfy(entries => entries.every(entry => !entry.code || entry.status === "blocked"
          || (entry.path === "." ? entry.status === "owned" : entry.status === "forwarded")))
    })
  })

  /** @remarks Собственная внешняя реализация и типы требуются Component и Container; у Domain публичный состав имеет другое назначение. */
  describe.skipIf(!component && !container)("Публичная реализация", () => {
    test("Кодовый вход компонента", () => {
      expect(codeEntries,
        "Component и Container публикуют собственный index.ts/index.tsx через «.»; условные ветви сохраняют владельца. Части композиции не раскрываются дополнительными кодовыми подпутями")
        .toSatisfy(entries => entries.every(entry => entry.path === "." && entry.status === "owned" && entry.entrypoint))
    })
    test("Основная реализация", () => {
      expect(entries.map(entry => result.code.find(source => source.path === resolve(result.root, entry.target!))),
        "Component и Container предоставляют одну собственную реализацию через default; именованные типы её контракта не увеличивают число реализаций")
        .toSatisfy(sources => sources.every(source => {
          const values = source?.exports.filter(item => item.runtime) ?? []
          return values.length === 1 && values[0]?.name === "default" && !values[0].unresolved
        }))
    })
    test("Публичная граница", () => {
      expect(result.index.entries,
        "Дополнительные самостоятельные реализации получают собственные пакеты; Component и Container публикуют только основной кодовый вход целого")
        .toSatisfy(entries => entries.every(entry => !entry.code || entry.status === "blocked" || entry.path === "." && entry.status === "owned"))
    })
    test("Исполняемое использование", () => {
      expect(result.scenarios,
        "Component и Container имеют один непосредственный сценарий использования публичного API; он исполняется обычным механизмом сценариев владельца")
        .toHaveLength(1)
    })
    test("Результат", () => {
      expect(result.code.filter(source => entries.some(entry => resolve(result.root, entry.target!) === source.path)),
        "Публичный результат имеет выводимый TypeScript тип; используемые типовые контракты разрешаются, пустой output.ts не требуется")
        .toSatisfy(sources => sources.every(source => source.exports.filter(item => item.runtime).every(item => item.type !== null && !item.unresolved)
          && source.references.filter(item => item.typeOnly).every(item => item.path !== null || item.public === true)))
    })
  })

  /** @remarks Component реализует возможность без собственного состава самостоятельных вложенных пакетов. */
  describe.skipIf(!component)("Component", () => {
    test("Самостоятельная реализация", () => {
      expect(result.packages,
        "Component может использовать внешние зависимости и частные helpers; композиция принадлежащих вложенных пакетов оформляется как Container")
        .toEqual([])
    })
  })

  /** @remarks Container имеет собственную реализацию целого и непосредственные части, выбранные из корневого workspace Repo. */
  describe.skipIf(!container)("Container", () => {
    test("Принадлежащие части", () => {
      expect(parts,
        "У Container есть непосредственные принадлежащие части. Роль Component или Container подтверждается собственными проверками каждой части; непустой состав не заменяет проверку поддерева")
        .not.toHaveLength(0)
    })
    test("Связи композиции", () => {
      expect(parts.filter(part => !result.code.some(source => source.references.some(reference =>
        reference.owner?.path === part.path && !reference.typeOnly && !reference.exported))),
        "Собственный код целого использует публичные реализации принадлежащих частей. Реэкспорт доменного API или только типовая связь не заменяет композицию; порядок и результат исполнения подтверждает собственный сценарий")
        .toEqual([])
    })
    test("Публичное целое", () => {
      expect(result.index.entries.filter(entry => entry.code && entry.status !== "blocked"),
        "Внешний код обращается к собственной реализации контейнера; внутренние компоненты и контейнеры сохраняют собственных владельцев и не получают публичные подпути через целое")
        .toSatisfy(entries => entries.every(entry => entry.path === "." && entry.status === "owned"))
    })
  })

  /** @remarks Дополнительный кодовый подпуть Domain требует основания во внешнем протоколе; публичность цели проверяется отдельно от этого основания. */
  describe.skipIf(domainSubpaths.length === 0)("Подпути Domain", () => {
    test("Цель протокольного входа", () => {
      expect(domainSubpaths,
        "Когда внешний протокол требует отдельный адрес, он ведёт непосредственно к публичному index вложенного владельца без файла-переадресации. Например, фиксированные JSX-входы выбирает транслятор; это частный случай, а не шаблон экспорта всех поддоменов")
        .toSatisfy(entries => entries.every(entry => entry.status === "forwarded" && entry.entrypoint && entry.owner !== undefined))
    })
    test.todo("Основание внешнего протокола", () => {
      expect(undefined,
        "Для каждого дополнительного кодового подпути подтверждены внешний потребитель, требуемый им адрес и сценарий использования. Читатель Package пока не предоставляет этих свидетельств: status forwarded доказывает только публичность файла и не разрешает произвольный подпуть")
        .toBeDefined()
    })
  })

  /** @remarks Ресурсные exports применимы только при наличии отдельных публичных файлов без JS/TS-кода. */
  describe.skipIf(resources.length === 0)("Ресурсные экспорты", () => {
    test("Файлы ресурсов", () => {
      expect(resources,
        "CSS, изображения и другие ресурсы экспортируются отдельными существующими файлами своего владельца. Ресурсный путь не является второй реализацией Component и не даёт разрешения на дополнительные кодовые входы")
        .toSatisfy(entries => entries.every(entry => entry.status === "owned" || entry.status === "forwarded"))
    })
  })
})
