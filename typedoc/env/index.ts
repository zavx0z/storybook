/** Объявляет источники знаний Typedoc без чтения их содержимого.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import type {StorybookTypedocEnv as Contract} from "./contract"
export type {StorybookTypedocEnv} from "./contract"

/** Сохраняет ссылки на документы у предметного владельца. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {...base, documents: {
      "Документация объявлений кода": {package: "@zavx0z/storybook-typedoc", path: "meta/notes/authoring.md"},
      ...base.documents}}
}
