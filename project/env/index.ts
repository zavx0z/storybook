/** Декларация окружения Project: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import type {StorybookProjectEnv as Contract} from "./contract"
export type {StorybookProjectEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {package: "@zavx0z/storybook-project-env", path: "src/initial.md"}},
    documents: {
      "Роль специалиста": {package: "@zavx0z/storybook-project-env", path: "src/initial.md"},
      "Агентная организация разработки": {package: "@zavx0z/storybook-project", path: "src/agents.md"},

      "Основания": {package: "@zavx0z/storybook-project", path: "meta/notes/foundations/index.md"},
      "Смысл и выразительность": {package: "@zavx0z/storybook-project", path: "meta/notes/foundations/meaning.md"},
      "Эмерджентность и естественные ограничения": {package: "@zavx0z/storybook-project", path: "meta/notes/foundations/emergence.md"},
      "Единство и узнаваемость": {package: "@zavx0z/storybook-project", path: "meta/notes/foundations/coherence.md"},
      "Простота и сложность": {package: "@zavx0z/storybook-project", path: "meta/notes/foundations/simplicity.md"},
      "Знание и понимание": {package: "@zavx0z/storybook-project", path: "meta/notes/foundations/knowledge.md"},
      "Созидание и свобода": {package: "@zavx0z/storybook-project", path: "meta/notes/foundations/creation.md"},
      "Проектирование": {package: "@zavx0z/storybook-project", path: "src/architecture.md"},
      ...base.documents,
    },
  }
}
