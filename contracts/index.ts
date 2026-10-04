/**
Контракт раскрывает вход, результат и слоты публичной возможности.
Component и Container владеют соглашением своей реализации. Cluster владеет
общим протоколом, участники — его расширениями. Средовые входы Domain сохраняют
собственные либо делегированные протоколы и исходные реализации.
Определения формы находятся в contract,
внутренние типы реализации остаются у использующего их кода.

Читатель получает native символы TypeScript без выполнения исследуемого пакета.
Имена частных файлов не определяют Input, Output и Slots: их задаёт namespace.
Имя namespace выражает физический путь от Repo до исходного владельца в PascalCase.
Организация npm и Project в имя не входят; package.json#name не служит источником
ожидаемого имени. Несовпадение возвращается предупреждением namespace-name,
неустановленная Git-граница — namespace-name-context. Чтение форм продолжается.
Проверки охватывают Component и Container с обычной либо JSX-реализацией,
средовые протоколы и происхождение расширений общего соглашения.
Runtime Storybook и MCP сохраняют отдельный жизненный цикл.

@packageDocumentation
*/
import readPackage from "@zavx0z/storybook-package-reader"
import {realpath} from "node:fs/promises"
import {resolve} from "node:path"
import {readNamespaces} from "./src/read"
import {contractFiles} from "./src/placement"
import type {StorybookContracts} from "./contract"

export type {StorybookContracts} from "./contract"

/**
Читает публичные namespace пакета и происхождение входящих в них типов.

@param input - Корень проверяемого пакета; код, callbacks и сценарии пакета не запускаются.
@returns Один согласованный снимок объявлений, типовых ролей и структурных нарушений.
@throws Ошибки файловой системы, разрешения TypeScript или изменения исходников во время чтения.
*/
export default async function readContract(input: StorybookContracts.Input): Promise<StorybookContracts.Output> {
  const path = await realpath(resolve(input.path))
  const definitions = await contractFiles(path)
  const description = await readPackage({path})
  return readNamespaces(description, definitions)
}
