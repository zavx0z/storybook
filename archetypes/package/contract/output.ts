import type {ReadPackageJsonOutput} from "@archetypes/package-json"
import type {ReadModuleDocumentationOutput} from "@archetypes/package-documentation"
import type {ReadPackageIndexOutput} from "@archetypes/package-index"

/**
Прочитанный состав пакета.

@property packageJson - Результат чтения непосредственно принадлежащего пакету package.json.

@property documentation - Модульный TSDoc корневого index или null, если его нет.

@property index - Публичные входы, их принадлежность и доступные файлы контрактов.
Наличие файлов не подтверждает смысловую полноту API или правильность управления состоянием.

@property packages - Самостоятельные вложенные пакеты из workspaces, без повторных identity.
parent указывает физический пакет, непосредственно содержащий участника.
*/
export interface ReadPackageOutput {
  readonly packageJson: ReadPackageJsonOutput
  readonly documentation: ReadModuleDocumentationOutput | null
  readonly index: ReadPackageIndexOutput
  readonly packages: readonly {readonly path: string, readonly name: string, readonly parent: string}[]
}
