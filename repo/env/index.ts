/** Декларация окружения Repo: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import {fileURLToPath} from "node:url"
import type {StorybookRepoEnv as Contract} from "./contract"
export type {StorybookRepoEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  if (Object.hasOwn(base.tools, "git.status")) throw new Error("Повтор имени инструмента: git.status")
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))}},
    documents: {
      "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))},
      "Проектирование Repo": {path: fileURLToPath(new URL("../src/design.md", import.meta.url)), children: {
        "Ответственность и принадлежность": {path: fileURLToPath(new URL("../src/design/ownership.md", import.meta.url))},
        "От ответственности к форме": {path: fileURLToPath(new URL("../src/design/form.md", import.meta.url))},
        "Ответственность, подготовка и исполнение": {path: fileURLToPath(new URL("../src/design/execution.md", import.meta.url))},
      }},

      "Архитектура Repo": {path: fileURLToPath(new URL("../src/architecture.md", import.meta.url)), children: {
        "Области репозитория": {path: fileURLToPath(new URL("../src/architecture/areas.md", import.meta.url))},
        "Принадлежность и участие": {path: fileURLToPath(new URL("../src/architecture/ownership.md", import.meta.url))},
        "Направление зависимостей": {path: fileURLToPath(new URL("../src/architecture/dependencies.md", import.meta.url))},
        "Применение стиля": {path: fileURLToPath(new URL("../src/architecture/application.md", import.meta.url))},
      }},
      ...base.documents,
    },
    tools: {...base.tools, "git.status": {
      implementation: {path: fileURLToPath(import.meta.resolve("@zavx0z/ai-git-status"))},
      description: {path: fileURLToPath(import.meta.resolve("@zavx0z/ai-git-status/description.json"))},
    }},
  }
}
