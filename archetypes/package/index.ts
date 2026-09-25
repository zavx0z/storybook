/**
Собирает описание выбранного пакета из его манифеста, корневого TSDoc и публичных входов.
Чтение не исполняет код пакета и не запускает его компоненты или подписки.

@packageDocumentation
*/
import {resolve} from "node:path"
import {readPackageJson} from "@archetypes/package/package-json"
import {readPackageIndex} from "@archetypes/package/index"
import {readRootDocumentation} from "./src/root-documentation"
import type {ReadPackageInput} from "./contract/input"
import type {ReadPackageOutput} from "./contract/output"

export type {ReadPackageInput, ReadPackageOutput}

/**
Читает непосредственный package.json и передаёт состав exports читателю входов.
Отсутствующее описание модуля обозначается null; README не читается.

@param path - Директория пакета; относительный путь разрешается от cwd.

@returns Манифест, модульное описание и фактические цели публичных экспортов.
@throws Ошибки чтения, разбора и проверки package.json.
*/
export async function readPackage({path}: ReadPackageInput): Promise<ReadPackageOutput> {
  const directory = resolve(path)
  const packageJson = await readPackageJson({path: resolve(directory, "package.json")})
  const [documentation, index] = await Promise.all([
    readRootDocumentation(directory),
    readPackageIndex({path: directory, exports: packageJson.exports}),
  ])
  return {
    packageJson,
    documentation,
    index,
  }
}
