/** Декларация окружения Component: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import {fileURLToPath} from "node:url"
import type {StorybookComponentEnv as Contract} from "./contract"
export type {StorybookComponentEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))}},
    documents: {
      "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))},
      "Размещение и ответственность Component": {path: fileURLToPath(new URL("../src/architecture.md", import.meta.url))},
      "Границы проверки Component": {path: fileURLToPath(new URL("../meta/notes/verification.md", import.meta.url))},
      "Принадлежность представлений Component": {path: fileURLToPath(new URL("../meta/notes/presentation-ownership.md", import.meta.url))},
      ...base.documents,
    },
  }
}
