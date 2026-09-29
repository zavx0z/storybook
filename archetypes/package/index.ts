/**
Собирает описание выбранного пакета из манифеста, корневого TSDoc, публичных входов
и состава вложенных пакетов. Package является общей структурной формой Repo,
Domain и Component; наличие вложенных пакетов не создаёт дополнительного класса.
Чтение не исполняет код пакета и не запускает его компоненты или подписки.

@packageDocumentation
*/
import {resolve} from "node:path"
import {readPackageJson} from "@archetypes/package-json"
import {readPackageIndex} from "@archetypes/package-index"
import {readRootDocumentation} from "./src/root-documentation"
import {readPackageComposition} from "./src/composition"
import type {ReadPackageInput} from "./contract/input"
import type {ReadPackageOutput} from "./contract/output"

export type {ReadPackageInput, ReadPackageOutput}

/**
Читает непосредственный package.json и передаёт состав exports читателю входов.
Отсутствующее описание модуля обозначается null; README не читается.

@param path - Директория пакета; относительный путь разрешается от cwd.

@returns Манифест, модульное описание, фактические цели публичных экспортов и состав.
@throws Ошибки чтения, разбора и проверки package.json.
*/
export async function readPackage({path}: ReadPackageInput): Promise<ReadPackageOutput> {
  const directory = resolve(path)
  const packageJson = await readPackageJson({path: resolve(directory, "package.json")})
  const [documentation, index, packages] = await Promise.all([
    readRootDocumentation(directory),
    readPackageIndex({path: directory, exports: packageJson.exports}),
    readPackageComposition(directory, packageJson),
  ])
  return {
    packageJson,
    documentation,
    index,
    packages,
  }
}
