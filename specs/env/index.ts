/** Объявляет источники знаний Specs без чтения их содержимого.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import {fileURLToPath} from "node:url"
import type {StorybookSpecsEnv as Contract} from "./contract"
export type {StorybookSpecsEnv} from "./contract"

/** Сохраняет ссылки на документы у предметного владельца. */
export default function environment(input: Contract.Input = {}): Contract.Output {
  const base = packageEnvironment(input)
  return {...base, documents: {
      "Спецификации владельца": {path: fileURLToPath(new URL("../meta/notes/structure.md", import.meta.url))},
      "Авторство и представление сценария": {path: fileURLToPath(new URL("../scenarios/meta/notes/presentation.md", import.meta.url))},
      "Представление исполняемых спецификаций": {path: fileURLToPath(new URL("../presentation/meta/notes/presentation.md", import.meta.url))},
      ...base.documents}}
}
