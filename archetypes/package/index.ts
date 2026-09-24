/**
Собирает описание выбранного пакета из его манифеста, обзора и публичных входов.
Чтение не исполняет код пакета и не запускает его компоненты или подписки.

@packageDocumentation
*/
import {resolve} from "node:path"
import {readPackageJson} from "@archetypes/package/package-json"
import {readPackageReadme} from "@archetypes/package/readme"
import {readPackageIndex} from "@archetypes/package/index"
import type {ReadPackageInput} from "./contract/input"
import type {ReadPackageOutput} from "./contract/output"

export type {ReadPackageInput, ReadPackageOutput}

/**
Читает непосредственный package.json и передаёт состав exports читателю входов.
Отсутствующий README или файл входа остаётся видимым в результате для проверок.

@param path - Директория пакета; относительный путь разрешается от cwd.

@returns Назначение пакета, его обзор и фактические цели публичных экспортов.
@throws Ошибки чтения, разбора и проверки package.json.
*/
export async function readPackage({path}: ReadPackageInput): Promise<ReadPackageOutput> {
  const directory = resolve(path)
  const packageJson = await readPackageJson({path: resolve(directory, "package.json")})
  const [readme, index] = await Promise.all([
    readPackageReadme({path: directory}),
    readPackageIndex({path: directory, exports: packageJson.exports}),
  ])
  return {
    packageJson,
    readme,
    index,
  }
}
