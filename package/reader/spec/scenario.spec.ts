/**
Показывает и проверяет общие требования Package и применимые правила Repo,
Domain, Cluster, Component или Container. Один запуск служит проверкой, документацией и примером;
классификация выражена разделами и утверждениями этого же сценария.
props.path позволяет применить те же проверки к другому пакету.
Файловая полнота не доказывает смысловую правильность компонента и его состояния.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {basename, dirname, relative, resolve, sep} from "node:path"
import readPackage from "@archetypes/package"
import readContract from "@archetypes/contracts"
import readDomain from "@archetypes/domain"
import readScenario from "@archetypes/scenario-reader"
import {runtimeOwnedParts} from "./runtime-owned-parts"

describe.each([
  {name: "Архетип пакета", props: {path: resolve(import.meta.dir, "..")}},
])("$name", async ({props}) => {
  const result = await readPackage(props)
  const entries = result.index.entries.filter(entry => entry.path === "." && entry.code && entry.status === "owned")
  const localCode = result.code.filter(source => source.statements.length > 0
    || source.exports.some(item => item.runtime && item.declarations.some(declaration => declaration.owner?.path === result.root)))
  const repo = result.repository.gitRoot === result.root
  const contract = repo ? null : await readContract({path: result.root})
  const rootProtocols = contract?.entries.filter(entry => entry.exportPath === ".") ?? []
  const ownProtocols = [...new Map(rootProtocols.flatMap(entry => entry.namespaces.filter(namespace => namespace.declaration.owner?.path === result.root))
    .map(namespace => [`${namespace.declaration.path}:${namespace.declaration.name}`, namespace])).values()]
  const cluster = !repo && result.packages.length > 0 && localCode.length === 0 && ownProtocols.length > 0
  const environmentEntries = entries.filter(entry => entry.target && !/^index\.tsx?$/u.test(basename(entry.target))
    && entry.conditions.some(condition => !["default", "import", "require", "types", "module", "module-sync", "development", "production"].includes(condition)))
  const domain = !repo && !cluster && environmentEntries.length > 0
  const implementation = !repo && entries.some(entry => result.code.some(source =>
    source.path === resolve(result.root, entry.target!) && source.exports.some(item => item.runtime && item.declarations.some(declaration => declaration.owner?.path === result.root))))
  const component = !domain && !cluster && implementation && result.packages.length === 0
  const container = !domain && !cluster && implementation && result.packages.length > 0
  const inferredContract = contract !== null
    && contract.entries.every(entry => entry.exports.every(item => item.name === "default" && item.runtime))
    && !contract.sources.some(source => source.path.startsWith(resolve(result.root, "contract") + sep))
  const parts = result.packages.filter(part => part.parent === result.root)
  const participatingParts = container ? await runtimeOwnedParts(result) : new Set<string>()
  const codeEntries = result.index.entries.filter(entry => entry.code && entry.status !== "blocked")
  const domainSubpaths = codeEntries.filter(entry => entry.path !== "." && entry.status === "forwarded")
  const resources = result.index.entries.filter(entry => !entry.code && entry.status !== "blocked")
  const domainFacts = domain ? await readDomain({path: result.root}) : null
  const rootSources = result.code.filter(source => entries.some(entry => entry.target && resolve(result.root, entry.target) === source.path))
  const clusterMembers = [...new Map(rootSources.flatMap(source => source.exports.filter(value => value.runtime)
    .flatMap(value => value.declarations).flatMap(value => value.owner ? [[value.owner.path, value.owner] as const] : []))).values()]
  const repositoryRoot = result.repository.gitRoot
  const directoryAncestors = repositoryRoot === null || repo ? []
    : [basename(repositoryRoot), ...relative(repositoryRoot, result.root).split(sep).slice(0, -1)]
  const packageSegments = result.packageJson.name.split("/")
  const packageScope = result.packageJson.name.startsWith("@") ? packageSegments[0] : undefined

  describe("Назначение", () => {
    test("Идентичность", () => {
      expect(result.packageJson.name, "Пакет имеет собственное имя из package.json").toMatch(/\S/u)
      if (result.packageJson.label !== undefined) {
        expect(result.packageJson.label, "Заданная подпись объясняет предмет пакета человеку").toMatch(/\S/u)
      }
    })
    test("Ответственность", () => {
      expect(result.packageJson.description, "Описание сообщает, для чего существует пакет").toMatch(/\S/u)
      expect(domain ? result.entryDocumentation.filter(entry => entry.path === ".").map(entry => entry.documentation?.markdown)
        : [result.documentation?.markdown], "TSDoc каждого основного входа раскрывает назначение и границы ответственности пакета")
        .toSatisfy(documents => documents.length > 0 && documents.every(document => typeof document === "string" && /\S/u.test(document)))
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
    test("Адреса зависимостей", () => {
      expect(result.code.flatMap(source => source.references).filter(reference =>
        reference.module.startsWith("file:") || reference.module.startsWith("/")
        || reference.module.startsWith(".") && reference.owner?.path !== result.root),
        "Относительные импорты и реэкспорты связывают только внутренние модули своего пакета. Другой пакет, включая вложенный, используется по имени и публичному адресу из exports; абсолютные и file: пути не заменяют эту границу")
        .toEqual([])
    })
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
          if (!reference.owner || reference.owner.path === result.root) return true
          const name = reference.module.startsWith(".") || reference.module.startsWith("/") || reference.module.startsWith("file:")
            ? reference.owner.name
            : reference.module.startsWith("@") ? reference.module.split("/").slice(0, 2).join("/") : reference.module.split("/")[0]!
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

  /** @remarks Полную цепочку предков можно проверить только при известной границе Repo. */
  describe.skipIf(repositoryRoot === null)("Именование", () => {
    test.each([
      {label: "Имя директории", name: basename(result.root), ancestors: directoryAncestors},
      {label: "Имя пакета", name: packageSegments.at(-1)!, ancestors: [...directoryAncestors, ...(packageScope ? [packageScope] : [])]},
    ])("$label", async ({name, ancestors}) => {
      const report = await readScenario({
        path: resolve(import.meta.dir, "../../name/spec/scenario.spec.ts"),
        variant: 0,
        props: {name, ancestors},
      })
      expect(report.exitCode, `Сценарий Name проверяет фактическое имя и предков до Repo: ${report.stderr}`).toBe(0)
      expect(report.tests.filter(point => ["failed", "error", "not-executed"].includes(point.status)),
        "Ошибки вложенного сценария именования сохраняются в проверке Package").toEqual([])
      expect(report.tests.filter(point => point.status === "todo").map(point => point.label),
        "Лексическая проверка не заменяет незавершённую проверку смысла").toContain("Смысл имени")
    }, 30_000)
    test.todo("Смысл именования", () => {
      expect(undefined, "Смысл имени ещё не проверен сценарием Name; отсутствие повторения не доказывает его правильность").toBeDefined()
    })
  })

  /** @remarks Без Git-границы невозможно установить весь контекст до Repo. */
  describe.skipIf(repositoryRoot !== null)("Неустановленная граница именования", () => {
    test.todo("Контекст до Repo", () => {
      expect(repositoryRoot, "Граница Repo установлена до проверки имён; пустая цепочка не подменяет неизвестный контекст").not.toBeNull()
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
        "Repo находится в корне Git. Domain связывает средовые входы одной сущности; Cluster имеет собственный общий протокол участников; Component реализует возможность, Container — целое из принадлежащих частей. Каталог реэкспортов не подтверждает роль. Кандидат требует всех применимых проверок, а смысл и поведение подтверждаются отдельно.")
        .toSatisfy(() => Number(repo) + Number(domain) + Number(cluster) + Number(component) + Number(container) === 1)
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

  /** @remarks Средовые входы являются кандидатами Domain; их протоколы и общие определения проверяются отдельно от имён файлов. */
  describe.skipIf(!domain)("Domain", () => {
    test.todo("Предметный смысл и инварианты", () => {
      expect(undefined,
        "Domain сохраняет один предметный смысл и инварианты сущности в разных средах. Функции и протоколы её воплощений могут различаться: имя пакета и имя в протоколе выполняют разные обязанности, сохраняя смысл имени. Средой может выступать другая предметная сущность. Общие исходные типы подтверждают происхождение определений, но сами по себе не доказывают сохранение смысла и инвариантов")
        .toBeDefined()
    })
    test("Корневой API домена", () => {
      expect(entries, "Domain имеет непустой набор собственных основных входов в корне, без обязательного общего index")
        .toSatisfy(values => values.length > 0 && values.every(entry => entry.target !== null && dirname(resolve(result.root, entry.target)) === result.root))
    })
    test("Входы сред домена", () => {
      expect(entries, "Каждый основной вход имеет реальное условие среды; режимы и формат модуля не создают среду")
        .toSatisfy(values => values.every(entry => environmentEntries.includes(entry)))
    })
    test("Общие определения сущности", () => {
      expect(domainFacts!.sharedDefinitions, "Протоколы сред сохраняют общие исходные определения. Полноту общих правил подтверждают предметные сценарии")
        .not.toHaveLength(0)
    })
    test("Реализации сред", () => {
      const implementations = rootProtocols.map(entry => entry.implementation)
      expect(implementations, "Разные средовые входы имеют собственные воплощения; повтор одного переносимого Component или Container не создаёт Domain")
        .toSatisfy(values => values.every(value => value !== null) && new Set(values.map(value =>
          `${value?.path}:${value?.line}:${value?.name}`)).size === new Set(entries.map(entry => entry.target)).size)
    })
    test("Протокол выбранной реализации", () => {
      expect(rootProtocols, "Протокол принадлежит самой сущности либо точно выбранному владельцу реализации, а не постороннему пакету")
        .toSatisfy(values => values.every(entry => entry.namespaces.length === 1 && entry.namespaces.every(namespace =>
          namespace.declaration.owner?.path === result.root || namespace.declaration.owner?.path === entry.implementation?.owner?.path)))
    })
    test("Происхождение API", () => {
      expect(rootSources.flatMap(source => source.exports), "Каждый публичный символ разрешён до исходного владельца, в том числе при default-делегировании")
        .toSatisfy(values => values.every(value => !value.unresolved && value.declarations.length > 0))
    })
  })

  /** @remarks Cluster раскрывает общий протокол и самостоятельных участников; собственная исполняемая композиция имеет другую роль. */
  describe.skipIf(!cluster)("Cluster", () => {
    test.todo("Общая роль и функция", () => {
      expect(undefined,
        "Участники Cluster выполняют одну общую роль и функцию: замена одного другим в этой роли сохраняет смысл применения. Кнопка с текстом и кнопка с иконкой вызывают заданное действие, а их собственные протоколы дополняют общий особенностями представления. Совпадение входных данных и типовая совместимость сами по себе не подтверждают общую роль, функцию и её гарантии")
        .toBeDefined()
    })
    test("Общий протокол группы", () => {
      expect(ownProtocols, "Основной вход публикует один принадлежащий кластеру общий namespace с содержательными ролями")
        .toSatisfy(values => values.length === 1 && values[0]!.roles.length > 0)
    })
    test("Самостоятельные участники", () => {
      expect(clusterMembers, "Именованные runtime-возможности принадлежат самостоятельным вложенным владельцам")
        .toSatisfy(values => values.length > 0 && values.every(member => result.packages.some(part => part.path === member.path)))
      expect(rootSources.flatMap(source => source.exports).filter(value => value.runtime), "Группа раскрывает участников по именам и не подменяет их одним default-целым")
        .toSatisfy(values => values.length === clusterMembers.length && values.every(value => value.name !== "default" && !value.unresolved))
      expect(localCode, "Публикация группы не запускает собственную исполняемую композицию").toEqual([])
    })
    test("Расширение общего протокола", () => {
      expect(clusterMembers.filter(member => !contract!.extensions.some(extension => extension.base.owner?.path === result.root
        && extension.member.owner?.path === member.path && extension.roles.length > 0
        && extension.roles.every(role => role.linked && role.compatible))),
      "Каждый участник сохраняет исходные общие определения и совместимо расширяет все роли; копия полей не заменяет эту связь")
        .toEqual([])
    })
    test("Все принадлежащие участники", () => {
      expect(parts.filter(part => !rootProtocols.some(entry => entry.namespaces.some(namespace =>
        namespace.declaration.owner?.path === part.path)) || !contract!.extensions.some(extension =>
        extension.base.owner?.path === result.root && extension.member.owner?.path === part.path
          && extension.roles.length > 0 && extension.roles.every(role => role.linked && role.compatible))),
      "Каждый непосредственный участник, включая вложенную группу, раскрывает свой протокол и сохраняет общий; отсутствие реэкспорта не скрывает чужеродного ребёнка")
        .toEqual([])
    })
    test("Совместное использование", () => {
      expect(result.scenarios, "Cluster имеет собственный сценарий общих гарантий на реальных участниках").toHaveLength(1)
    })
    test("Публичный доступ к протоколу", () => {
      expect(codeEntries.filter(entry => entry.path === "./contract"),
        "Дети используют один публичный type-only вход общего протокола без обратного runtime-импорта каталога").toHaveLength(1)
      expect(contract!.entries.filter(entry => entry.exportPath === "./contract"),
        "Отдельный типовой вход публикует тот же общий namespace, что основной API группы")
        .toSatisfy(values => values.length === 1 && values[0]!.namespaces.length === 1
          && values[0]!.namespaces[0]!.declaration.path === ownProtocols[0]?.declaration.path
          && values[0]!.namespaces[0]!.declaration.name === ownProtocols[0]?.declaration.name)
      expect(codeEntries, "Cluster предоставляет основной именованный API и самостоятельный type-only вход общего контракта для детей")
        .toSatisfy(values => values.every(entry => entry.status === "owned" && (entry.path === "."
          || entry.path === "./contract" && result.code.some(source => entry.target && source.path === resolve(result.root, entry.target)
            && source.exports.length === 1 && source.exports.every(value => !value.runtime)))))
    })
  })

  /** @remarks Component, Container и каждый средовой вход Domain предоставляют одну реализацию с соответствующим протоколом. */
  describe.skipIf(!component && !container && !domain)("Публичная реализация", () => {
    test("Кодовый вход компонента", () => {
      expect(codeEntries,
        "Component и Container публикуют единственный index через «.»; Domain — выбранный вход среды. Части композиции не раскрываются дополнительными кодовыми подпутями")
        .toSatisfy(entries => entries.every(entry => entry.path === "." && entry.status === "owned" && (domain || entry.target !== null && /^index\.tsx?$/u.test(basename(entry.target)))))
    })
    test("Основная реализация", () => {
      expect(entries.map(entry => result.code.find(source => source.path === resolve(result.root, entry.target!))),
        "Каждый вход предоставляет одну основную реализацию через default; типовой протокол не увеличивает число реализаций")
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
        "Владелец имеет один непосредственный сценарий публичного API и применимых сред; наличие файла не заменяет выполненного поведения")
        .toHaveLength(1)
    })
    test("Результат", () => {
      expect(result.code.filter(source => entries.some(entry => resolve(result.root, entry.target!) === source.path)),
        "Публичный результат имеет выводимый TypeScript тип; используемые типовые контракты разрешаются, пустой output.ts не требуется")
        .toSatisfy(sources => sources.every(source => source.exports.filter(item => item.runtime).every(item => item.type !== null && !item.unresolved)
          && source.references.filter(item => item.typeOnly).every(item => item.path !== null || item.public === true)))
    })
  })

  /** @remarks Переносимый Component или Container сохраняет одну реализацию через один физический индекс. */
  describe.skipIf(!component && !container)("Индексный вход", () => {
    test("Единственная реализация", () => {
      expect(new Set(entries.map(entry => entry.target)).size,
        "Поддержка нескольких сред не создаёт несколько основных реализаций Component или Container").toBe(1)
    })
    test("Владение протоколом", () => {
      expect(rootProtocols.flatMap(entry => entry.namespaces),
        "Component и Container сохраняют собственный протокол целого; типы его составляющих могут принадлежать другим владельцам")
        .toSatisfy(values => values.every(namespace => namespace.declaration.owner?.path === result.root))
    })
  })

  /** @remarks Собственная типовая граница относится к Component и Container; простая форма default без авторского namespace выводится из сигнатуры. */
  describe.skipIf(repo)("Типовой контракт", () => {
    test("Диагностика публичной границы", () => {
      expect(contract!.diagnostics.filter(diagnostic => diagnostic.severity === "error"
        && !((component || container) && inferredContract && ["component-exports", "namespace-missing"].includes(diagnostic.code))),
      "Ошибки публичного контракта не становятся успешной проверкой Package; только отсутствие авторского namespace у простой выводимой формы не требует отдельного объявления")
        .toEqual([])
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
      expect(parts.filter(part => !participatingParts.has(part.path)),
        "Каждая непосредственная часть связана с собственными runtime-исходниками целого напрямую или через другие принадлежащие части. Реэкспорт API, только типовая связь, внешний пакет и отсоединённый цикл частей не заменяют композицию; фактическое исполнение подтверждает собственный сценарий")
        .toEqual([])
    })
    test("Публичное целое", () => {
      expect(result.index.entries.filter(entry => entry.code && entry.status !== "blocked"),
        "Внешний код обращается к собственной реализации контейнера; внутренние компоненты и контейнеры сохраняют собственных владельцев и не получают публичные подпути через целое")
        .toSatisfy(entries => entries.every(entry => entry.path === "." && entry.status === "owned"))
    })
  })

  /** @remarks Дополнительный перенаправленный кодовый подпуть требует основания во внешнем протоколе; публичность цели проверяется отдельно от этого основания. */
  describe.skipIf(domainSubpaths.length === 0)("Внешние протоколы", () => {
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
