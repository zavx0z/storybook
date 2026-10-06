/** Объявляет источники знаний Contracts без чтения их содержимого.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import {fileURLToPath} from "node:url"
import type {StorybookContractsEnv as Contract} from "./contract"
export type {StorybookContractsEnv} from "./contract"

/** Сохраняет ссылки на документы у предметного владельца. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {...base, documents: {
      "Модель контрактов": {path: fileURLToPath(new URL("../meta/notes/draft-contracts.md", import.meta.url))},
      ...base.documents}}
}
