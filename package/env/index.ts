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
    "Хранение данных владельцев": {path: fileURLToPath(new URL("../src/storage.md", import.meta.url))},

    "Структура Project, Repo и пакетов": {path: fileURLToPath(new URL("../src/architecture.md", import.meta.url))},
    "Развитие структуры": {path: fileURLToPath(new URL("../meta/notes/development.md", import.meta.url))},
    "Документация поведения и ответственности": {path: fileURLToPath(new URL("../meta/notes/draft-documentation.md", import.meta.url))},
    "Публичные входы и происхождение экспортов": {path: fileURLToPath(new URL("../meta/notes/draft-exports.md", import.meta.url))},
    "Переходная проекция директорий": {path: fileURLToPath(new URL("../meta/notes/draft-projections.md", import.meta.url))},
    "Переход архетипов и состояние проверок": {path: fileURLToPath(new URL("../meta/notes/archetype-transition.md", import.meta.url))},
    "Жизненный цикл заметок": {path: fileURLToPath(new URL("../meta/notes/note-lifecycle.md", import.meta.url))},
  }
  for (const key of ["input", "output", "slots"] as const) if (sources?.[key]) documents[key] = {path: sources[key].path}
  for (const [index, path] of (sources?.scenarios ?? []).entries()) documents[`scenario.${index + 1}`] = {path}
  return {rules: extra.rules, documents, tools: {...standard, ...extra.tools}}
}
