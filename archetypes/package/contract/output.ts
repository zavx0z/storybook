import type {ReadPackageJsonOutput} from "@archetypes/package-json"
import type {ReadModuleDocumentationOutput} from "@archetypes/package-documentation"
import type {ReadPackageIndexOutput} from "@archetypes/package-index"

/**
Прочитанный состав пакета.

@property packageJson - Результат чтения непосредственно принадлежащего пакету package.json.

@property documentation - Модульный TSDoc корневого index или null, если его нет.

@property index - Публичные входы, их принадлежность и доступные файлы контрактов.
Наличие файлов не подтверждает смысловую полноту API или правильность управления состоянием.

@property root - Каноническая директория пакета.

@property repository - Наблюдаемая Git-граница и вложенные самостоятельные репозитории.
Не задаёт класс пакета и не изменяет Git.

@property code - Runtime exports собственных публичных исходников и корневых index.
Пустые и type-only входы сохраняются; чужие реализации не исполняются и не сканируются.

@property scenarios - Непосредственные файлы сценария использования, без их выполнения.

@property packages - Самостоятельные вложенные пакеты из workspaces, без повторных identity.
parent указывает физический пакет, непосредственно содержащий участника.
*/
export interface ReadPackageOutput {
  readonly root: string
  readonly repository: {readonly gitRoot: string | null, readonly nestedRepositories: readonly string[]}
  readonly code: readonly {readonly path: string, readonly exports: readonly string[]}[]
  readonly scenarios: readonly string[]
  readonly packageJson: ReadPackageJsonOutput
  readonly documentation: ReadModuleDocumentationOutput | null
  readonly index: ReadPackageIndexOutput
  readonly packages: readonly {readonly path: string, readonly name: string, readonly parent: string}[]
}
