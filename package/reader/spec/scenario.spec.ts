/**
Показывает и проверяет общие требования Package и применимые правила Repo,
Domain, Cluster, Component или Container. Один запуск служит проверкой, документацией и примером;
Применимость нормативных требований и кандидаты роли раскрыты в actual проверок.
Регистрация тем одинакова для любого props.path; тип подтверждает весь отчёт.
props.path позволяет применить те же проверки к другому пакету.
Файловая полнота не доказывает смысловую правильность компонента и его состояния.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {lstat, readdir} from "node:fs/promises"
import {basename, dirname, relative, resolve, sep} from "node:path"
import readPackage from "@zavx0z/storybook-package-reader"
import readPackageJson from "@zavx0z/storybook-package-package-json"
import readIgnored from "@zavx0z/storybook-package-route-ignored"
import readContract from "@zavx0z/storybook-contracts"
import readDomain from "@zavx0z/storybook-domain"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"
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
  const repoManifest = repositoryRoot === null ? null : repo ? result.packageJson
    : await readPackageJson({path: resolve(repositoryRoot, "package.json")})
  const repoIdentity = repoManifest?.name.match(/^(@[a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/u)
  const relativeDirectories = repositoryRoot === null || repo ? [] : relative(repositoryRoot, result.root).split(sep)
  const packageParents = repoIdentity === null || repoIdentity === undefined || repo ? []
    : [repoIdentity[2]!, ...relativeDirectories.slice(0, -1)]
  const inheritedPrefix = packageParents.length === 0 ? "" : `${packageParents.join("-")}-`
  const packageLocalName = packageSegments.at(-1)!
  const ownPackageName = packageLocalName.startsWith(inheritedPrefix)
    ? packageLocalName.slice(inheritedPrefix.length) : packageLocalName
  const siblingPaths = repositoryRoot === null || repo ? []
    : (await readdir(dirname(result.root), {withFileTypes: true}))
      .filter(entry => entry.isDirectory() && !entry.name.startsWith(".")
        && entry.name !== "node_modules" && entry.name !== basename(result.root))
      .map(entry => resolve(dirname(result.root), entry.name)).sort()
  const ignoredSiblings = repositoryRoot === null ? [] : (await readIgnored({
    root: repositoryRoot, repository: repositoryRoot, paths: siblingPaths,
  })).ignored
  const visibleSiblings = siblingPaths.filter(path => !ignoredSiblings.includes(path))
  const directorySiblings = visibleSiblings.map(path => basename(path))
  const packageSiblings: string[] = []
  for (const path of visibleSiblings) {
    const manifest = resolve(path, "package.json")
    const file = await lstat(manifest).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    })
    if (!file?.isFile() || file.isSymbolicLink()) continue
    const sibling = await readPackageJson({path: manifest})
    const local = sibling.name.split("/").at(-1)!
    packageSiblings.push(local.startsWith(inheritedPrefix) ? local.slice(inheritedPrefix.length) : local)
  }

  describe("Назначение", () => {
    test("Идентичность", () => {
      expect(result.packageJson.name, "Пакет имеет собственное имя из package.json").toMatch(/\S/u)
      if (result.packageJson.label !== undefined) {
        expect(result.packageJson.label, "Заданная подпись объясняет предмет пакета человеку").toMatch(/\S/u)
      }
    })
    test("Ответственность", () => {
      expect(result.packageJson.description, "В package.json задано непустое описание пакета; наличие текста не подтверждает его смысловое качество").toMatch(/\S/u)
      expect(domain ? result.entryDocumentation.filter(entry => entry.path === ".").map(entry => entry.documentation?.markdown)
        : [result.documentation?.markdown], "TSDoc каждого основного входа раскрывает назначение и границы ответственности пакета")
        .toSatisfy(documents => documents.length > 0 && documents.every(document => typeof document === "string" && /\S/u.test(document)))
    })
  })

  describe("Описание пакета", () => {
    test.todo("Сущность", () => {
      expect(result.packageJson.description,
        "description в package.json — краткое определение того, чем является пакет. Оно раскрывает его предмет и смысловую роль; перечень выполняемых операций не заменяет определение сущности")
        .toBeDefined()
    })
    test.todo("Самодостаточность", () => {
      expect(result.packageJson.description,
        "Описание понятно само по себе, без знания репозитория, расположения файлов и окружающего контекста. Читателю не приходится восстанавливать предмет из имени или соседних пакетов")
        .toBeDefined()
    })
    test.todo("Существенные отличия", () => {
      expect(result.packageJson.description,
        "Смысловые свойства и отношения объясняют, к чему относится пакет и чем он отличается от похожих сущностей. Состав раскрывается, когда он существенен для понимания предмета")
        .toBeDefined()
    })
    test.todo("Уровень подробности", () => {
      expect(result.packageJson.description,
        "Перечни файлов, экспортов, зависимостей и подробности реализации не входят в определение. Технические понятия уместны, когда обозначают сам предмет пакета, например синтаксический анализатор TypeScript")
        .toBeDefined()
    })
    test.todo("Достаточная краткость", () => {
      expect(result.packageJson.description,
        "Текст сокращается до достаточного объяснения, сохраняя суть. Отвлечённые подписи вроде «инструмент» или «смысловая группа» без раскрытия предмета не являются понятным описанием")
        .toBeDefined()
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
  describe("Именование", () => {
    test.each([
      {label: "Имя директории", name: basename(result.root), ancestors: directoryAncestors, siblings: directorySiblings},
      {label: "Имя пакета", name: ownPackageName, ancestors: packageParents, siblings: packageSiblings},
    ])("$label", async ({name, ancestors, siblings}) => {
      const report = repositoryRoot === null ? null : await readScenario({
        path: resolve(import.meta.dir, "../../name/spec/scenario.spec.ts"),
        variant: 0,
        props: {name, ancestors, siblings},
      })
      expect({applicable: repositoryRoot !== null, value: report?.exitCode ?? null},
        `Сценарий Name проверяет фактическое имя и предков до Repo: ${report?.stderr ?? "Граница Repo не установлена"}`)
        .toSatisfy(({applicable, value}) => !applicable || (value === 0))
      expect({applicable: repositoryRoot !== null, value: report?.tests.filter(point => ["failed", "error", "not-executed"].includes(point.status)) ?? null},
        "Ошибки вложенного сценария именования сохраняются в проверке Package")
        .toSatisfy(({applicable, value}) => !applicable || (value !== null && value.length === 0))
      expect({applicable: repositoryRoot !== null, value: report?.tests.filter(point => point.status === "todo").map(point => point.label) ?? null},
        "Лексическая проверка не заменяет незавершённую проверку смысла")
        .toSatisfy(({applicable, value}) => !applicable || (value !== null && value.includes("Смысл имени")))
    }, 30_000)
    test.todo("Смысл именования", () => {
      expect({applicable: repositoryRoot !== null, value: undefined},
        "Смысл имени ещё не проверен сценарием Name; отсутствие повторения не доказывает его правильность")
        .toSatisfy(({applicable, value}) => !applicable || (value !== undefined))
    })
  })

  /** @remarks Вложенный пакет наследует организацию Repo; путь от Repo записывается после косой черты. */
  describe("Имя по расположению", () => {
    test("Путь родителей в npm-имени", () => {
      const inheritedName = repoIdentity ? `${repoIdentity[1]}/${[repoIdentity[2], ...relativeDirectories].join("-")}` : null
      expect({applicable: repositoryRoot !== null && !repo, name: result.packageJson.name, inheritedName},
        "Scope принадлежит организации Repo. После / перечислены имя Repo, родительские директории и имя пакета через дефис. Project не участвует. Например, @zavx0z/storybook и путь package/name дают @zavx0z/storybook-package-name; неустановленная организация Repo не подменяется вымышленным scope")
        .toSatisfy(({applicable, name, inheritedName}) => !applicable || inheritedName !== null && name === inheritedName)
    })
  })

  /** @remarks Без Git-границы невозможно установить весь контекст до Repo. */
  describe("Неустановленная граница именования", () => {
    test.todo("Контекст до Repo", () => {
      expect({applicable: repositoryRoot === null, value: repositoryRoot},
        "Граница Repo установлена до проверки имён; пустая цепочка не подменяет неизвестный контекст")
        .toSatisfy(({applicable, value}) => !applicable || (value !== null))
    })
  })

  /** @remarks Нераскрытая карта зависимого владельца не доказывает ни публичность, ни нарушение границы. */
  describe("Нераскрытые границы", () => {
    test.todo("Полнота публичных границ", () => {
      expect({applicable: result.code.some(source => source.references.some(reference => reference.public === null && reference.path !== null)), value: result.code.flatMap(source => source.references).filter(reference => reference.public === null && reference.path !== null)},
        "Публичность каждого разрешённого импорта подтверждена картой владельца")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
  })

  /** @remarks Структурная роль проверяется после полного раскрытия exports; иначе сохраняется TODO полноты ниже. */
  describe("Классификация", () => {
    test("Структурная роль", () => {
      expect({complete: result.index.unchecked.length === 0, roles: {Repo: repo, Component: component, Container: container, Cluster: cluster, Domain: domain}},
        "Repo находится в корне Git. Domain связывает средовые входы одной сущности; Cluster имеет собственный общий протокол участников; Component реализует возможность, Container — целое из принадлежащих частей. Каталог реэкспортов не подтверждает роль. Кандидат требует всех применимых проверок, а смысл и поведение подтверждаются отдельно. Неполное раскрытие exports сохраняет неизвестность типа.")
        .toSatisfy(({complete, roles}) => !complete || Object.values(roles).filter(applicable => applicable).length === 1)
    })
  })

  /** @remarks Полнота файловой проверки применима, когда все объявления exports раскрыты. */
  describe("Раскрытые exports", () => {
    test("Полнота файловой проверки", () => {
      expect({applicable: result.index.unchecked.length === 0, value: result.index.unchecked},
        "Все объявления этого примера входят в область файловой проверки")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
  })

  /** @remarks Нераскрытые объявления требуют отдельной проверки; при полном раскрытии exports тема неприменима. */
  describe("Нераскрытые exports", () => {
    test.todo("Полнота раскрытия exports", () => {
      expect({applicable: result.index.unchecked.length > 0, value: result.index.unchecked},
        "Все объявления этого примера входят в область файловой проверки")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
  })

  /** @remarks Repo проверяется только для пакета в точном корне собственной Git-истории. */
  describe("Repo", () => {
    test("Организация в npm-имени Repo", () => {
      expect({applicable: repo, value: result.packageJson.name},
        "Repo имеет scoped npm-имя @организация/репозиторий. Организация наследуется вложенными пакетами; имя Project не входит в npm-адрес")
        .toSatisfy(({applicable, value}) => !applicable || (/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u.test(value)))
    })
    test("Экспорты репозитория", () => {
      expect({applicable: repo, value: result.packageJson.exports},
        "Repo без собственного публичного API может не объявлять exports: читатель возвращает {}. Состав вложенных пакетов задаётся workspaces и сам по себе не требует экспортировать их через Repo")
        .toSatisfy(({applicable, value}) => !applicable || (value !== null && typeof value === "object" && !Array.isArray(value)))
      expect({applicable: repo, value: codeEntries},
        "Если Repo публикует код, каждый объявленный вход ведёт к index своего владельца; закрытые файлы вложенных пакетов не становятся API репозитория")
        .toSatisfy(({applicable, value: entries}) => !applicable || (entries.every(entry => entry.entrypoint)))
    })
    test("Корневые glob", () => {
      const declaration = result.packageJson.workspaces
      const patterns = declaration === undefined ? [] : "packages" in declaration ? declaration.packages : declaration
      const include = patterns.filter(pattern => !pattern.startsWith("!"))
      expect({applicable: repo, value: include},
        "Repo использует glob без ручного перечисления пакетов; пустому составу workspaces не обязательны")
        .toSatisfy(({applicable, value: patterns}) => !applicable || (patterns.every(pattern => pattern.includes("*"))))
      expect({applicable: repo, value: result.packages},
        "Каждый рабочий пакет входит ровно в один положительный glob Repo")
        .toSatisfy(({applicable, value: packages}) => !applicable || (packages.every(item => include.filter(pattern => new Bun.Glob(`${pattern}/package.json`)
          .match(`${item.path.slice(result.root.length + 1)}/package.json`)).length === 1)))
    })
    test("Независимые репозитории", () => {
      expect({applicable: repo, value: result.repository.nestedRepositories},
        "Другие самостоятельные Repo подключаются к Project, а не вкладываются в этот Repo")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
  })

  /** @remarks Средовые входы являются кандидатами Domain; их протоколы и общие определения проверяются отдельно от имён файлов. */
  describe("Domain", () => {
    test.todo("Предметный смысл и инварианты", () => {
      expect({applicable: domain, value: undefined},
        "Domain сохраняет один предметный смысл и инварианты сущности в разных средах. Функции и протоколы её воплощений могут различаться: имя пакета и имя в протоколе выполняют разные обязанности, сохраняя смысл имени. Средой может выступать другая предметная сущность. Общие исходные типы подтверждают происхождение определений, но сами по себе не доказывают сохранение смысла и инвариантов")
        .toSatisfy(({applicable, value}) => !applicable || (value !== undefined))
    })
    test("Корневой API домена", () => {
      expect({applicable: domain, value: entries},
        "Domain имеет непустой набор собственных основных входов в корне, без обязательного общего index")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.length > 0 && values.every(entry => entry.target !== null && dirname(resolve(result.root, entry.target)) === result.root)))
    })
    test("Входы сред домена", () => {
      expect({applicable: domain, value: entries},
        "Каждый основной вход имеет реальное условие среды; режимы и формат модуля не создают среду")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.every(entry => environmentEntries.includes(entry))))
    })
    test("Общие определения сущности", () => {
      expect({applicable: domain, value: domainFacts?.sharedDefinitions ?? []},
        "Протоколы сред сохраняют общие исходные определения. Полноту общих правил подтверждают предметные сценарии")
        .toSatisfy(({applicable, value}) => !applicable || (value.length > 0))
    })
    test("Реализации сред", () => {
      const implementations = rootProtocols.map(entry => entry.implementation)
      expect({applicable: domain, value: implementations},
        "Разные средовые входы имеют собственные воплощения; повтор одного переносимого Component или Container не создаёт Domain")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.every(value => value !== null) && new Set(values.map(value =>
          `${value?.path}:${value?.line}:${value?.name}`)).size === new Set(entries.map(entry => entry.target)).size))
    })
    test("Протокол выбранной реализации", () => {
      expect({applicable: domain, value: rootProtocols},
        "Протокол принадлежит самой сущности либо точно выбранному владельцу реализации, а не постороннему пакету")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.every(entry => entry.namespaces.length === 1 && entry.namespaces.every(namespace =>
          namespace.declaration.owner?.path === result.root || namespace.declaration.owner?.path === entry.implementation?.owner?.path))))
    })
    test("Происхождение API", () => {
      expect({applicable: domain, value: rootSources.flatMap(source => source.exports)},
        "Каждый публичный символ разрешён до исходного владельца, в том числе при default-делегировании")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.every(value => !value.unresolved && value.declarations.length > 0)))
    })
  })

  /** @remarks Cluster раскрывает общий протокол и самостоятельных участников; собственная исполняемая композиция имеет другую роль. */
  describe("Cluster", () => {
    test.todo("Общая роль и функция", () => {
      expect({applicable: cluster, value: undefined},
        "Участники Cluster выполняют одну общую роль и функцию: замена одного другим в этой роли сохраняет смысл применения. Кнопка с текстом и кнопка с иконкой вызывают заданное действие, а их собственные протоколы дополняют общий особенностями представления. Совпадение входных данных и типовая совместимость сами по себе не подтверждают общую роль, функцию и её гарантии")
        .toSatisfy(({applicable, value}) => !applicable || (value !== undefined))
    })
    test("Общий протокол группы", () => {
      expect({applicable: cluster, value: ownProtocols},
        "Основной вход публикует один принадлежащий кластеру общий namespace с содержательными ролями")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.length === 1 && values[0]!.roles.length > 0))
    })
    test("Самостоятельные участники", () => {
      expect({applicable: cluster, value: clusterMembers},
        "Именованные runtime-возможности принадлежат самостоятельным вложенным владельцам")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.length > 0 && values.every(member => result.packages.some(part => part.path === member.path))))
      expect({applicable: cluster, value: rootSources.flatMap(source => source.exports).filter(value => value.runtime)},
        "Группа раскрывает участников по именам и не подменяет их одним default-целым")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.length === clusterMembers.length && values.every(value => value.name !== "default" && !value.unresolved)))
      expect({applicable: cluster, value: localCode},
        "Публикация группы не запускает собственную исполняемую композицию")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
    test("Расширение общего протокола", () => {
      expect({applicable: cluster, value: clusterMembers.filter(member => !(contract?.extensions ?? []).some(extension => extension.base.owner?.path === result.root
        && extension.member.owner?.path === member.path && extension.roles.length > 0
        && extension.roles.every(role => role.linked && role.compatible)))},
        "Каждый участник сохраняет исходные общие определения и совместимо расширяет все роли; копия полей не заменяет эту связь")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
    test("Все принадлежащие участники", () => {
      expect({applicable: cluster, value: parts.filter(part => !rootProtocols.some(entry => entry.namespaces.some(namespace =>
        namespace.declaration.owner?.path === part.path)) || !(contract?.extensions ?? []).some(extension =>
        extension.base.owner?.path === result.root && extension.member.owner?.path === part.path
          && extension.roles.length > 0 && extension.roles.every(role => role.linked && role.compatible)))},
        "Каждый непосредственный участник, включая вложенную группу, раскрывает свой протокол и сохраняет общий; отсутствие реэкспорта не скрывает чужеродного ребёнка")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
    test("Совместное использование", () => {
      expect({applicable: cluster, value: result.scenarios},
        "Cluster имеет собственный сценарий общих гарантий на реальных участниках")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 1))
    })
    test("Публичный доступ к протоколу", () => {
      expect({applicable: cluster, value: codeEntries.filter(entry => entry.path === "./contract")},
        "Дети используют один публичный type-only вход общего протокола без обратного runtime-импорта каталога")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 1))
      expect({applicable: cluster, value: (contract?.entries ?? []).filter(entry => entry.exportPath === "./contract")},
        "Отдельный типовой вход публикует тот же общий namespace, что основной API группы")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.length === 1 && values[0]!.namespaces.length === 1
          && values[0]!.namespaces[0]!.declaration.path === ownProtocols[0]?.declaration.path
          && values[0]!.namespaces[0]!.declaration.name === ownProtocols[0]?.declaration.name))
      expect({applicable: cluster, value: codeEntries},
        "Cluster предоставляет основной именованный API и самостоятельный type-only вход общего контракта для детей")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.every(entry => entry.status === "owned" && (entry.path === "."
          || entry.path === "./contract" && result.code.some(source => entry.target && source.path === resolve(result.root, entry.target)
            && source.exports.length === 1 && source.exports.every(value => !value.runtime))))))
    })
  })

  /** @remarks Component, Container и каждый средовой вход Domain предоставляют одну реализацию с соответствующим протоколом. */
  describe("Публичная реализация", () => {
    test("Кодовый вход компонента", () => {
      expect({applicable: component || container || domain, value: codeEntries},
        "Component и Container публикуют единственный index через «.»; Domain — выбранный вход среды. Части композиции не раскрываются дополнительными кодовыми подпутями")
        .toSatisfy(({applicable, value: entries}) => !applicable || (entries.every(entry => entry.path === "." && entry.status === "owned" && (domain || entry.target !== null && /^index\.tsx?$/u.test(basename(entry.target))))))
    })
    test("Основная реализация", () => {
      expect({applicable: component || container || domain, value: entries.map(entry => result.code.find(source => source.path === resolve(result.root, entry.target!)))},
        "Каждый вход предоставляет одну основную реализацию через default; типовой протокол не увеличивает число реализаций")
        .toSatisfy(({applicable, value: sources}) => !applicable || (sources.every(source => {
          const values = source?.exports.filter(item => item.runtime) ?? []
          return values.length === 1 && values[0]?.name === "default" && !values[0].unresolved
        })))
    })
    test("Публичная граница", () => {
      expect({applicable: component || container || domain, value: result.index.entries},
        "Дополнительные самостоятельные реализации получают собственные пакеты; Component и Container публикуют только основной кодовый вход целого")
        .toSatisfy(({applicable, value: entries}) => !applicable || (entries.every(entry => !entry.code || entry.status === "blocked" || entry.path === "." && entry.status === "owned")))
    })
    test("Исполняемое использование", () => {
      expect({applicable: component || container || domain, value: result.scenarios},
        "Владелец имеет один непосредственный сценарий публичного API и применимых сред; наличие файла не заменяет выполненного поведения")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 1))
    })
    test("Результат", () => {
      expect({applicable: component || container || domain, value: result.code.filter(source => entries.some(entry => resolve(result.root, entry.target!) === source.path))},
        "Публичный результат имеет выводимый TypeScript тип; используемые типовые контракты разрешаются, пустой output.ts не требуется")
        .toSatisfy(({applicable, value: sources}) => !applicable || (sources.every(source => source.exports.filter(item => item.runtime).every(item => item.type !== null && !item.unresolved)
          && source.references.filter(item => item.typeOnly).every(item => item.path !== null || item.public === true))))
    })
  })

  /** @remarks Переносимый Component или Container сохраняет одну реализацию через один физический индекс. */
  describe("Индексный вход", () => {
    test("Единственная реализация", () => {
      expect({applicable: component || container, value: new Set(entries.map(entry => entry.target)).size},
        "Поддержка нескольких сред не создаёт несколько основных реализаций Component или Container")
        .toSatisfy(({applicable, value}) => !applicable || (value === 1))
    })
    test("Владение протоколом", () => {
      expect({applicable: component || container, value: rootProtocols.flatMap(entry => entry.namespaces)},
        "Component и Container сохраняют собственный протокол целого; типы его составляющих могут принадлежать другим владельцам")
        .toSatisfy(({applicable, value: values}) => !applicable || (values.every(namespace => namespace.declaration.owner?.path === result.root)))
    })
  })

  /** @remarks Собственная типовая граница относится к Component и Container; простая форма default без авторского namespace выводится из сигнатуры. */
  describe("Типовой контракт", () => {
    test("Диагностика публичной границы", () => {
      expect({applicable: !repo, value: (contract?.diagnostics ?? []).filter(diagnostic => diagnostic.severity === "error"
        && !((component || container) && inferredContract && ["component-exports", "namespace-missing"].includes(diagnostic.code)))},
        "Ошибки публичного контракта не становятся успешной проверкой Package; только отсутствие авторского namespace у простой выводимой формы не требует отдельного объявления")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
  })

  /** @remarks Component реализует возможность без собственного состава самостоятельных вложенных пакетов. */
  describe("Component", () => {
    test("Самостоятельная реализация", () => {
      expect({applicable: component, value: result.packages},
        "Component может использовать внешние зависимости и частные helpers; композиция принадлежащих вложенных пакетов оформляется как Container")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
  })

  /** @remarks Container имеет собственную реализацию целого и непосредственные части, выбранные из корневого workspace Repo. */
  describe("Container", () => {
    test("Принадлежащие части", () => {
      expect({applicable: container, value: parts},
        "У Container есть непосредственные принадлежащие части. Роль Component или Container подтверждается собственными проверками каждой части; непустой состав не заменяет проверку поддерева")
        .toSatisfy(({applicable, value}) => !applicable || (value.length > 0))
    })
    test("Связи композиции", () => {
      expect({applicable: container, value: parts.filter(part => !participatingParts.has(part.path))},
        "Каждая непосредственная часть связана с собственными runtime-исходниками целого напрямую или через другие принадлежащие части. Реэкспорт API, только типовая связь, внешний пакет и отсоединённый цикл частей не заменяют композицию; фактическое исполнение подтверждает собственный сценарий")
        .toSatisfy(({applicable, value}) => !applicable || (value.length === 0))
    })
    test("Публичное целое", () => {
      expect({applicable: container, value: result.index.entries.filter(entry => entry.code && entry.status !== "blocked")},
        "Внешний код обращается к собственной реализации контейнера; внутренние компоненты и контейнеры сохраняют собственных владельцев и не получают публичные подпути через целое")
        .toSatisfy(({applicable, value: entries}) => !applicable || (entries.every(entry => entry.path === "." && entry.status === "owned")))
    })
  })

  /** @remarks Дополнительный перенаправленный кодовый подпуть требует основания во внешнем протоколе; публичность цели проверяется отдельно от этого основания. */
  describe("Внешние протоколы", () => {
    test("Цель протокольного входа", () => {
      expect({applicable: domainSubpaths.length > 0, value: domainSubpaths},
        "Когда внешний протокол требует отдельный адрес, он ведёт непосредственно к публичному index вложенного владельца без файла-переадресации. Например, фиксированные JSX-входы выбирает транслятор; это частный случай, а не шаблон экспорта всех поддоменов")
        .toSatisfy(({applicable, value: entries}) => !applicable || (entries.every(entry => entry.status === "forwarded" && entry.entrypoint && entry.owner !== undefined)))
    })
    test.todo("Основание внешнего протокола", () => {
      expect({applicable: domainSubpaths.length > 0, value: undefined},
        "Для каждого дополнительного кодового подпути подтверждены внешний потребитель, требуемый им адрес и сценарий использования. Читатель Package пока не предоставляет этих свидетельств: status forwarded доказывает только публичность файла и не разрешает произвольный подпуть")
        .toSatisfy(({applicable, value}) => !applicable || (value !== undefined))
    })
  })

  /** @remarks Ресурсные exports применимы только при наличии отдельных публичных файлов без JS/TS-кода. */
  describe("Ресурсные экспорты", () => {
    test("Файлы ресурсов", () => {
      expect({applicable: resources.length > 0, value: resources},
        "CSS, изображения и другие ресурсы экспортируются отдельными существующими файлами своего владельца. Ресурсный путь не является второй реализацией Component и не даёт разрешения на дополнительные кодовые входы")
        .toSatisfy(({applicable, value: entries}) => !applicable || (entries.every(entry => entry.status === "owned" || entry.status === "forwarded")))
    })
  })
})
