/** Декларация окружения Project: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import {fileURLToPath} from "node:url"
import type {StorybookProjectEnv as Contract} from "./contract"
export type {StorybookProjectEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))}},
    documents: {
      "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))},
      "Агентная организация разработки": {path: fileURLToPath(new URL("../src/agents.md", import.meta.url))},

      "Основания": {path: fileURLToPath(new URL("../meta/notes/foundations/index.md", import.meta.url)), children: {
        "Смысл и выразительность": {path: fileURLToPath(new URL("../meta/notes/foundations/meaning.md", import.meta.url))},
        "Эмерджентность и естественные ограничения": {path: fileURLToPath(new URL("../meta/notes/foundations/emergence.md", import.meta.url))},
        "Единство и узнаваемость": {path: fileURLToPath(new URL("../meta/notes/foundations/coherence.md", import.meta.url))},
        "Простота и сложность": {path: fileURLToPath(new URL("../meta/notes/foundations/simplicity.md", import.meta.url))},
        "Знание и понимание": {path: fileURLToPath(new URL("../meta/notes/foundations/knowledge.md", import.meta.url))},
        "Созидание и свобода": {path: fileURLToPath(new URL("../meta/notes/foundations/creation.md", import.meta.url))},
      }},
      "Проектирование": {path: fileURLToPath(new URL("../src/architecture.md", import.meta.url)), children: {
        "От замысла к предмету": {path: fileURLToPath(new URL("../src/architecture/intent.md", import.meta.url))},
        "Ответственность и принадлежность": {path: fileURLToPath(new URL("../../repo/src/design/ownership.md", import.meta.url))},
        "От ответственности к форме": {path: fileURLToPath(new URL("../../repo/src/design/form.md", import.meta.url))},
        "Ответственность, подготовка и исполнение": {path: fileURLToPath(new URL("../../repo/src/design/execution.md", import.meta.url))},
        "Проверка решения на применении": {path: fileURLToPath(new URL("../src/architecture/validation.md", import.meta.url))},
        "Реструктуризация и развитие": {path: fileURLToPath(new URL("../src/architecture/evolution.md", import.meta.url))},
        "Уточнение и распределение методики": {path: fileURLToPath(new URL("../src/architecture/method.md", import.meta.url))},
      }},
      ...base.documents,
    },
  }
}
