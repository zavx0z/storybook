/** Объявляет источники знаний Specs без чтения их содержимого.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import type {StorybookSpecsEnv as Contract} from "./contract"
export type {StorybookSpecsEnv} from "./contract"

/** Сохраняет ссылки на документы у предметного владельца. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {...base, documents: {
      "Спецификации владельца": {package: "@zavx0z/storybook", path: "specs/meta/notes/structure.md"},
      "Авторство и представление сценария": {package: "@zavx0z/storybook-specs-scenarios", path: "meta/notes/presentation.md"},
      "Представление исполняемых спецификаций": {package: "@zavx0z/storybook-specs-presentation", path: "meta/notes/presentation.md"},
      ...base.documents}}
}
