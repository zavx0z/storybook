/**
Формирует декларацию окружения Package: ссылки на правила, знания и инструменты.
Дополнения обнаруживаются только в собственном .agent. Сбор не читает документы
и не загружает реализации инструментов; исполнение принадлежит приложению.

@packageDocumentation
*/
import {fileURLToPath} from "node:url"
import {additions} from "./src/additions"
import {tools} from "./src/tools"
import type {StorybookPackageEnv as Contract} from "./contract"
export type {StorybookPackageEnv} from "./contract"

/** Собирает общий состав и дополнения владельца без подмены стандартных инструментов. */
export default function packageEnvironment({directory, sources}: Contract.Input = {}): Contract.Output {
  const extra = additions(directory)
  const standard = tools()
  for (const name of Object.keys(extra.tools)) if (Object.hasOwn(standard, name)) throw new Error(`Повтор имени инструмента: ${name}`)
  const documents: Record<string, Contract.Output["rules"][string]> = {
    "Общие правила Package": {path: fileURLToPath(new URL("../src/architecture.md", import.meta.url))},
    "Имена пакетов": {path: fileURLToPath(new URL("../name/spec/scenario.spec.ts", import.meta.url))},
    "Публичные границы пакета": {path: fileURLToPath(new URL("../meta/notes/draft-exports.md", import.meta.url))},
    "Документация пакета": {path: fileURLToPath(new URL("../meta/notes/draft-documentation.md", import.meta.url))},
    "Дополнения окружения пакета": {path: fileURLToPath(new URL("./src/architecture.md", import.meta.url))},
    "Данные работы пакета": {path: fileURLToPath(new URL("../src/storage.md", import.meta.url))},
    "Начало работы": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))},
  }
  for (const key of ["input", "output", "slots"] as const) if (sources?.[key]) documents[key] = {path: sources[key].path}
  for (const [index, path] of (sources?.scenarios ?? []).entries()) documents[`scenario.${index + 1}`] = {path}
  return {rules: {"Начало работы": documents["Начало работы"]!, ...extra.rules}, documents, tools: {...standard, ...extra.tools}}
}
