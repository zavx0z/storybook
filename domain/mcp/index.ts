/**
Раскрывает Domain агенту из сохранённых сведений Package.
Предметный владелец формирует описание, переходы, схемы контрактов и сценарии.
Чтение не запускает сущность и не исполняет её сценарии.

@packageDocumentation
*/
import navigation from "@zavx0z/storybook-package-mcp-navigation"
import content from "@zavx0z/storybook-package-mcp-content"
import createTools from "@zavx0z/storybook-package-mcp-tools"
import type {StorybookDomainMcp as Contract} from "./contract"

export type {StorybookDomainMcp} from "./contract"

/** Формирует содержательный ответ Domain, сохраняя точные источники и границы его участников. */
async function readDomainMcp({selected, entries}: Contract.Input): Promise<Contract.Output> {
  return {
    ...navigation({path: selected.path, description: selected.description, entries,
      ...(selected.label === undefined ? {} : {label: selected.label})}),
    ...await content(selected.sources),
  }
}

/** Собственное чтение и расширяемые инструменты назначенной области. */
export default Object.assign(readDomainMcp, {tools: createTools})
