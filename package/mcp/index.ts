/**
Раскрывает общие сведения Package и принадлежащих ему публичных модулей.
Сохраняет прежний ответ с описанием, переходами, схемами и исходниками сценариев.
До подтверждения предметного типа доступен навигационный ответ с явным статусом
проверки, который добавляет вызывающий маршрутизатор.

@packageDocumentation
*/
import navigation from "@zavx0z/storybook-package-mcp-navigation"
import content from "@zavx0z/storybook-package-mcp-content"
import createTools from "@zavx0z/storybook-package-mcp-tools"
import type {StorybookPackageMcp as Contract} from "./contract"

export type {StorybookPackageMcp} from "./contract"

/** Формирует ответ выбранного Package без запуска сценариев или повторного обнаружения. */
async function readPackageMcp({selected, entries, includeContent = true}: Contract.Input): Promise<Contract.Output> {
  return {
    ...navigation({path: selected.path, description: selected.description, entries,
      ...(selected.label === undefined ? {} : {label: selected.label})}),
    ...(includeContent ? await content(selected.sources) : {}),
  }
}

/** Собственное чтение и расширяемые инструменты назначенной области. */
export default Object.assign(readPackageMcp, {tools: createTools})
