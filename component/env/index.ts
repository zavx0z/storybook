/** Декларация окружения Component: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import type {StorybookComponentEnv as Contract} from "./contract"
export type {StorybookComponentEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {package: "@zavx0z/storybook-component-env", path: "src/initial.md"}},
    documents: {
      "Роль специалиста": {package: "@zavx0z/storybook-component-env", path: "src/initial.md"},
      "Размещение и ответственность Component": {package: "@zavx0z/storybook-component", path: "src/architecture.md"},
      "Границы проверки Component": {package: "@zavx0z/storybook-component", path: "meta/notes/verification.md"},
      "Принадлежность представлений Component": {package: "@zavx0z/storybook-component", path: "meta/notes/presentation-ownership.md"},
      ...base.documents,
    },
  }
}
