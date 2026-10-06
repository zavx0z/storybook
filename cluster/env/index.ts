/** Декларация окружения Cluster: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import type {StorybookClusterEnv as Contract} from "./contract"
export type {StorybookClusterEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {package: "@zavx0z/storybook-cluster-env", path: "src/initial.md"}},
    documents: {
      "Роль специалиста": {package: "@zavx0z/storybook-cluster-env", path: "src/initial.md"},
      "Структура Cluster": {package: "@zavx0z/storybook-cluster", path: "src/architecture.md"},
      ...base.documents,
    },
  }
}
