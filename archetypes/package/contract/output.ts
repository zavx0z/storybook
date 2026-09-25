import type {ReadPackageJsonOutput} from "@archetypes/package/package-json"
import type {ReadModuleDocumentationOutput} from "@archetypes/package/documentation"
import type {ReadPackageIndexOutput} from "@archetypes/package/index"

/**
Прочитанный состав пакета.

@property packageJson - Результат чтения непосредственно принадлежащего пакету package.json.

@property documentation - Модульный TSDoc корневого index или null, если его нет.

@property index - Публичные входы, их принадлежность и доступные файлы контрактов.
Наличие файлов не подтверждает смысловую полноту API или правильность управления состоянием.
*/
export interface ReadPackageOutput {
  readonly packageJson: ReadPackageJsonOutput
  readonly documentation: ReadModuleDocumentationOutput | null
  readonly index: ReadPackageIndexOutput
}
