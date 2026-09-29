/**
Repo — пакет-монорепозиторий с собственной историей и составом пакетов.
Project соединяет независимые Repo; вложенные самостоятельные репозитории
внутри одного Repo не входят в этот стандарт. Git-команды только читают состояние.

@packageDocumentation
*/
import readPackage from "@archetypes/package"
import type {ReadRepoInput} from "./contract/input"
import type {ReadRepoOutput} from "./contract/output"

export type {ReadRepoInput, ReadRepoOutput}

/** Читает точную Git-границу и gitlinks, сохраняя обычный пакет без Git как отрицательный пример. */
export default async function readRepo({path}: ReadRepoInput): Promise<ReadRepoOutput> {
  const description = await readPackage({path})
  return {package: description, root: description.root, ...description.repository}
}
