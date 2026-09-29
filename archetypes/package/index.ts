/**
Собирает описание выбранного пакета из манифеста, корневого TSDoc, публичных входов
и состава вложенных пакетов из корневых workspace glob Repo.
Domain и Component не повторяют декларацию состава. Читает Git-границу и runtime exports исходников;
эти факты раскрываются и проверяются в едином сценарии Package.
Package является общей структурной формой Repo,
Domain и Component; наличие вложенных пакетов не создаёт дополнительного класса.
Чтение не исполняет код пакета и не запускает его компоненты или подписки.

@packageDocumentation
*/
import {realpath} from "node:fs/promises"
import {resolve} from "node:path"
import {readPackageJson} from "@archetypes/package-json"
import {readPackageIndex} from "@archetypes/package-index"
import {readRootDocumentation} from "./src/root-documentation"
import {readPackageSources} from "./src/sources"
import {readRepositoryBoundary} from "./src/repository"
import {readPackageComposition} from "./src/composition"
import type {ReadPackageInput} from "./contract/input"
import type {ReadPackageOutput} from "./contract/output"

export type {ReadPackageInput, ReadPackageOutput}

/**
Читает непосредственный package.json и передаёт состав exports читателю входов.
Отсутствующее описание модуля обозначается null; README не читается.

@param path - Директория пакета; относительный путь разрешается от cwd.

@returns Структурные факты без поля классификации и без результата проверки стандарта.
@throws Ошибки чтения и разбора файлов, сканирования исходников и чтения состава Git.
*/
export async function readPackage({path}: ReadPackageInput): Promise<ReadPackageOutput> {
  const directory = await realpath(resolve(path))
  const packageJson = await readPackageJson({path: resolve(directory, "package.json")})
  const [documentation, index, packages] = await Promise.all([
    readRootDocumentation(directory),
    readPackageIndex({path: directory, exports: packageJson.exports}),
    readPackageComposition(directory, packageJson),
  ])
  const [sources, repository] = await Promise.all([
    readPackageSources(directory, index.entries),
    readRepositoryBoundary(directory, packages),
  ])
  return {
    root: directory,
    repository,
    ...sources,
    packageJson,
    documentation,
    index,
    packages,
  }
}
