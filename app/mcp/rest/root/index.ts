/**
Описывает текущий Project и направления его Repo через неизменный HTTP-прокси.
Общая форма и раскрытие направлений принадлежат Children.

@packageDocumentation
*/
import readMcpChildren from "@mcp/children"
import type {McpRoot} from "./contract"

export type {McpRoot} from "./contract"

/**
Добавляет собственное назначение входа к актуальным направлениям каталога.

@param input - Имя из package.json текущего Project и направления из его состава Repo.
@returns Имя Project и его направления без искусственного сегмента в адресах Repo.
*/
export default function readMcpRoot({projectName, entries}: McpRoot.Input): McpRoot.Output {
  if (typeof projectName !== "string" || projectName.trim().length === 0) throw new TypeError("Project name must be non-empty text")
  return readMcpChildren({
    label: projectName,
    description: "Выберите Repo текущего Project по описанию. Для перехода передайте path выбранного элемента children в следующий вызов storybook. Выбранный владелец раскрывает input и output как JSON Schema с описаниями. Пустой вызов возвращает к этому входу.",
    entries,
  })
}
