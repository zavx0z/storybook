/**
Repo — пакет-монорепозиторий с собственной историей и составом пакетов.
Project соединяет независимые Repo; вложенные самостоятельные репозитории
внутри одного Repo не входят в этот стандарт. Git-команды только читают состояние.

@packageDocumentation
*/
import readPackage from "@zavx0z/storybook-package-reader"
import type {StorybookRepoReader} from "./contract"

export type {StorybookRepoReader} from "./contract"

/** Читает точную Git-границу и gitlinks, сохраняя обычный пакет без Git как отрицательный пример. */
export default async function readRepo({path}: StorybookRepoReader.Input): Promise<StorybookRepoReader.Output> {
  const description = await readPackage({path})
  return {package: description, root: description.root, ...description.repository}
}
