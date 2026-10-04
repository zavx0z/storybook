/**
Раскрывает Component агенту из сохранённых сведений Package.
Предметный владелец формирует описание, переходы, схемы контрактов и сценарии.
Чтение не запускает сущность и не исполняет её сценарии.

@packageDocumentation
*/
import navigation from "@zavx0z/storybook-package-mcp-navigation"
import content from "@zavx0z/storybook-package-mcp-content"
import type {Zavx0zStorybookComponentMcp as Contract} from "./contract"

export type {Zavx0zStorybookComponentMcp} from "./contract"

/** Формирует содержательный ответ Component, сохраняя точные источники и границы его участников. */
export default async function readComponentMcp({selected, entries}: Contract.Input): Promise<Contract.Output> {
  return {
    ...navigation({path: selected.path, description: selected.description, entries,
      ...(selected.label === undefined ? {} : {label: selected.label})}),
    ...await content(selected.sources),
  }
}
