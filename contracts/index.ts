/**
Контракт раскрывает вход, результат и слоты публичной возможности.
Component и Container владеют соглашением своей реализации. Реэкспорт домена
сохраняет исходного владельца и не создаёт контракт Domain. Определения формы находятся в contract,
внутренние типы реализации остаются у использующего их кода.

Читатель получает native символы TypeScript без выполнения исследуемого пакета.
Имена частных файлов не определяют Input, Output и Slots: их задаёт namespace.
Имя namespace выражает полное имя пакета со scope в PascalCase. Несовпадение
возвращается предупреждением namespace-name и не прерывает чтение форм.
Сценарий Contracts проверяет Component и Container с обычной либо JSX-реализацией.
Runtime Storybook и MCP сохраняют отдельный жизненный цикл.

@packageDocumentation
*/
import readPackage from "@archetypes/package"
import {realpath} from "node:fs/promises"
import {resolve} from "node:path"
import {readNamespaces} from "./src/read"
import {contractFiles} from "./src/placement"
import type {ArchetypesContracts} from "./contract"

export type {ArchetypesContracts} from "./contract"

/**
Читает публичные namespace пакета и происхождение входящих в них типов.

@param input - Корень проверяемого пакета; код, callbacks и сценарии пакета не запускаются.
@returns Один согласованный снимок объявлений, типовых ролей и структурных нарушений.
@throws Ошибки файловой системы, разрешения TypeScript или изменения исходников во время чтения.
*/
export default async function readContract(input: ArchetypesContracts.Input): Promise<ArchetypesContracts.Output> {
  const path = await realpath(resolve(input.path))
  const definitions = await contractFiles(path)
  const description = await readPackage({path})
  return readNamespaces(description, definitions)
}
