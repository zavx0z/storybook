/** Декларация окружения Cluster: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import {fileURLToPath} from "node:url"
import type {StorybookClusterEnv as Contract} from "./contract"
export type {StorybookClusterEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    rules: {...base.rules, "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))}},
    documents: {
      "Роль специалиста": {path: fileURLToPath(new URL("./src/initial.md", import.meta.url))},
      "Структура Cluster": {path: fileURLToPath(new URL("../src/architecture.md", import.meta.url)), children: {
        "Общее и собственное": {path: fileURLToPath(new URL("../src/architecture/participants.md", import.meta.url))},
        "Публичность и происхождение": {path: fileURLToPath(new URL("../src/architecture/public.md", import.meta.url))},
        "Проверка принадлежности": {path: fileURLToPath(new URL("../src/architecture/ownership.md", import.meta.url))},
      }},
      ...base.documents,
    },
  }
}
