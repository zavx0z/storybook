import type {ReadPackageJsonOutput} from "@archetypes/package/package-json"
import type {ReadPackageReadmeOutput} from "@archetypes/package/readme"
import type {ReadPackageIndexOutput} from "@archetypes/package/index"

/**
Прочитанный состав пакета.

@property packageJson - Результат чтения непосредственно принадлежащего пакету package.json.

@property readme - Авторский обзор пакета или явное отсутствие README.

@property index - Публичные входы, их принадлежность и доступные файлы контрактов.
Наличие файлов не подтверждает смысловую полноту API или правильность управления состоянием.
*/
export interface ReadPackageOutput {
  readonly packageJson: ReadPackageJsonOutput
  readonly readme: ReadPackageReadmeOutput
  readonly index: ReadPackageIndexOutput
}
