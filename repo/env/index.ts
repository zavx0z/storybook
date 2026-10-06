/** Декларация окружения Repo: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import type {StorybookRepoEnv as Contract} from "./contract"
export type {StorybookRepoEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  if (Object.hasOwn(base.tools, "git.status")) throw new Error("Повтор имени инструмента: git.status")
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {package: "@zavx0z/storybook-repo-env", path: "src/initial.md"}},
    documents: {
      "Роль специалиста": {package: "@zavx0z/storybook-repo-env", path: "src/initial.md"},
      "Проектирование Repo": {package: "@zavx0z/storybook", path: "repo/src/design.md"},

      "Архитектура Repo": {package: "@zavx0z/storybook", path: "repo/src/architecture.md"},
      ...base.documents,
    },
    tools: {...base.tools, "git.status": {
      implementation: {package: "@zavx0z/ai-git-status", export: "."},
      description: {package: "@zavx0z/ai-git-status", path: "description.json"},
    }},
  }
}
