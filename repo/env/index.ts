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
    documents: {
      "Проектирование Repo": {path: fileURLToPath(new URL("../src/design.md", import.meta.url))},

      "Предметная архитектура проекта": {path: fileURLToPath(new URL("../src/architecture.md", import.meta.url))},
      ...base.documents,
    },
    tools: {...base.tools, "git.status": {
      implementation: {path: fileURLToPath(import.meta.resolve("@zavx0z/ai-git-status"))},
      description: {path: fileURLToPath(import.meta.resolve("@zavx0z/ai-git-status/description.json"))},
    }},
  }
}
