/** Декларация окружения Domain: собственные знания и общие возможности Package.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import {fileURLToPath} from "node:url"
import type {StorybookDomainEnv as Contract} from "./contract"
export type {StorybookDomainEnv} from "./contract"

/** Дополняет общую декларацию ссылками владельца без загрузки его инструментов. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {
    ...base,
    documents: {
      "Структура Domain": {path: fileURLToPath(new URL("../src/architecture.md", import.meta.url))},
      "Средовые реализации Domain": {path: fileURLToPath(new URL("../meta/notes/environments.md", import.meta.url))},
      ...base.documents,
    },
  }
}
