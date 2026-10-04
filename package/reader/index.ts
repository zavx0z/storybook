/**
Собирает описание выбранного пакета из манифеста, TSDoc каждого публичного входа
и состава вложенных пакетов из корневых workspace glob Repo.
Domain, Cluster, Component и Container не повторяют декларацию состава. Читает Git-границу и runtime exports публичных входов и собственных исходников src;
эти факты раскрываются и проверяются в едином сценарии Package.
Package является общей структурной формой Repo,
Domain, Cluster, Component и Container. Состав и происхождение реализации позволяют
сценарию различить область и композицию целого.
Настройки engines читаются только из собственного манифеста; принадлежность
общей среды разработки Repo раскрывается нормативным сценарием.
Чтение не исполняет код пакета и не запускает его компоненты или подписки.

@packageDocumentation
*/
import {realpath} from "node:fs/promises"
import {resolve} from "node:path"
import readPackageJson from "@storybook-package/package-json"
import readPackageIndex from "@storybook-package/index"
import {readRootDocumentation} from "./src/root-documentation"
import {readPackageSources} from "./src/sources"
import {readRepositoryBoundary} from "./src/repository"
import {readPackageComposition} from "./src/composition"
import type {StorybookPackageReader} from "./contract"

export type {StorybookPackageReader} from "./contract"

/**
Читает непосредственный package.json и передаёт состав exports читателю входов.
Отсутствующее описание модуля обозначается null; README не читается.
Средовые документы сохраняются отдельно вместе с целями и условиями exports.

@param path - Директория пакета; относительный путь разрешается от cwd.

@returns Структурные факты без поля классификации и без результата проверки стандарта.
@throws Ошибки чтения и разбора файлов, сканирования исходников и чтения состава Git.
*/
export default async function readPackage({path}: StorybookPackageReader.Input): Promise<StorybookPackageReader.Output> {
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
  const entryDocumentation = await Promise.all(index.entries
    .filter(entry => entry.code && entry.status === "owned" && entry.target !== null)
    .map(async entry => ({
      path: entry.path,
      target: entry.target!,
      conditions: entry.conditions,
      documentation: await readRootDocumentation(directory, [entry.target!]),
    })))
  return {
    root: directory,
    repository,
    ...sources,
    packageJson,
    documentation,
    entryDocumentation,
    index,
    packages,
  }
}
