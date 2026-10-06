/** Декларация окружения Domain: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import type {StorybookDomainEnv as Contract} from "./contract"
export type {StorybookDomainEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {package: "@zavx0z/storybook-domain-env", path: "src/initial.md"}},
    documents: {
      "Роль специалиста": {package: "@zavx0z/storybook-domain-env", path: "src/initial.md"},
      "Структура Domain": {package: "@zavx0z/storybook-domain", path: "src/architecture.md"},
      "Средовые реализации Domain": {package: "@zavx0z/storybook-domain", path: "meta/notes/environments.md"},
      ...base.documents,
    },
  }
}
