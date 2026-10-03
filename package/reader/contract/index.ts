import type {ArchetypesPackageJson} from "@archetypes/package-json"
import type {ArchetypesPackageDocumentation} from "@archetypes/package-documentation"
import type {ArchetypesPackageIndex} from "@archetypes/package-index"

export declare namespace ArchetypesPackage {
  /**
  Входной контракт чтения структуры пакета.

  @property path - Директория пакета, явно выбранная вызывающим кодом.
  */
  export interface Input {
    readonly path: string
  }

  /**
  Прочитанный состав пакета.

  @property packageJson - Результат чтения непосредственно принадлежащего пакету package.json.

  @property documentation - Модульный TSDoc корневого index или null, если его нет.

  @property entryDocumentation - Документация каждого принадлежащего пакету публичного входа с его адресом, целью и условиями. Разные среды не объединяются в один текст.

  @property index - Публичные входы, их принадлежность и доступные файлы контрактов.
  Наличие файлов не подтверждает смысловую полноту API или правильность управления состоянием.

  @property root - Каноническая директория пакета.

  @property repository - Наблюдаемая Git-граница и вложенные самостоятельные репозитории.
  Не задаёт класс пакета и не изменяет Git.

  @property code - Native символы публичных входов и достижимых модулей своего пакета: имя, runtime/type-only, тип и владельцы объявлений.
  statements сохраняет собственные исполняемые объявления и эффекты входа.
  references раскрывает зависимости входа и его контрактов; public проверяет доступность
  модуля у владельца. Обход включает внутренние type-only зависимости:
  частный тип не скрывает пересечение границы пакета. unresolved и null сохраняют отсутствие доказательства.
  TypeScript читает объявления без исполнения; классы пакетов здесь не назначаются.

  @property scenarios - Непосредственные файлы сценария использования, без их выполнения.

  @property packages - Самостоятельные вложенные пакеты из корневого workspace Repo, без повторных identity.
  parent указывает физический пакет, непосредственно содержащий участника.
  */
  export interface Output {
    readonly root: string
    readonly repository: {readonly gitRoot: string | null, readonly nestedRepositories: readonly string[]}
    readonly code: readonly {
      readonly path: string
      readonly exports: readonly {
        readonly name: string
        readonly runtime: boolean
        readonly type: string | null
        readonly unresolved: boolean
        readonly declarations: readonly {readonly path: string, readonly owner: {readonly path: string, readonly name: string} | null}[]
      }[]
      readonly statements: readonly string[]
      readonly references: readonly {
        readonly from: string
        readonly module: string
        readonly names: readonly string[]
        readonly typeOnly: boolean
        readonly exported: boolean
        readonly path: string | null
        readonly owner: {readonly path: string, readonly name: string} | null
        readonly public: boolean | null
      }[]
    }[]
    readonly scenarios: readonly string[]
    readonly packageJson: ArchetypesPackageJson.Output
    readonly documentation: ArchetypesPackageDocumentation.Output
    readonly entryDocumentation: readonly {
      readonly path: string
      readonly target: string
      readonly conditions: readonly string[]
      readonly documentation: ArchetypesPackageDocumentation.Output
    }[]
    readonly index: ArchetypesPackageIndex.Output
    readonly packages: readonly {readonly path: string, readonly name: string, readonly parent: string}[]
  }
}
