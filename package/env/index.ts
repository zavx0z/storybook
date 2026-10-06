/**
Формирует декларацию окружения Package: ссылки на правила, знания и инструменты.
Дополнения обнаруживаются только в собственном .agent. Сбор не читает документы
и не загружает реализации инструментов; исполнение принадлежит приложению.

@packageDocumentation
*/
import {reference} from "./src/reference"
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
    "Общие правила Package": {package: "@zavx0z/storybook", path: "package/src/architecture.md"},
    "Имена пакетов": {package: "@zavx0z/storybook-package-name", path: "spec/scenario.spec.ts"},
    "Публичные границы пакета": {package: "@zavx0z/storybook", path: "package/meta/notes/draft-exports.md"},
    "Документация пакета": {package: "@zavx0z/storybook", path: "package/meta/notes/draft-documentation.md"},
    "Дополнения окружения пакета": {package: "@zavx0z/storybook-package-env", path: "src/architecture.md"},
    "Данные работы пакета": {package: "@zavx0z/storybook", path: "package/src/storage.md"},
    "Начало работы": {package: "@zavx0z/storybook-package-env", path: "src/initial.md"},
  }
  for (const key of ["input", "output", "slots"] as const) if (sources?.[key]) documents[key] = reference(sources[key], directory)
  for (const [index, path] of (sources?.scenarios ?? []).entries()) documents[`scenario.${index + 1}`] = reference({path}, directory)
  return {rules: {"Начало работы": documents["Начало работы"]!, ...extra.rules}, documents, tools: {...standard, ...extra.tools}}
}
