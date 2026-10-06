/** Декларация окружения Container: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import type {StorybookContainerEnv as Contract} from "./contract"
export type {StorybookContainerEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {package: "@zavx0z/storybook-container-env", path: "src/initial.md"}},
    documents: {
      "Роль специалиста": {package: "@zavx0z/storybook-container-env", path: "src/initial.md"},
      "Структура Container": {package: "@zavx0z/storybook-container", path: "src/architecture.md"},
      ...base.documents,
    },
  }
}
