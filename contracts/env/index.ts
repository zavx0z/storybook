/** Объявляет источники знаний Contracts без чтения их содержимого.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import type {StorybookContractsEnv as Contract} from "./contract"
export type {StorybookContractsEnv} from "./contract"

/** Сохраняет ссылки на документы у предметного владельца. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {...base, documents: {
      "Модель контрактов": {package: "@zavx0z/storybook-contracts", path: "meta/notes/draft-contracts.md"},
      ...base.documents}}
}
