/** Декларация окружения Container: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import {fileURLToPath} from "node:url"
import type {StorybookContainerEnv as Contract} from "./contract"
export type {StorybookContainerEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))}},
    documents: {
      "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))},
      "Структура Container": {path: fileURLToPath(new URL("../src/architecture.md", import.meta.url)), children: {
        "Чтение и проверка": {path: fileURLToPath(new URL("../src/architecture/verification.md", import.meta.url))},
      }},
      ...base.documents,
    },
  }
}
