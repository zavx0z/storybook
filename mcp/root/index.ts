/**
Описывает начальную точку входа Storybook MCP независимо от подключённых проектов.
Общая форма и раскрытие направлений принадлежат Children.

@packageDocumentation
*/
import {readMcpChildren} from "@mcp/children"
import type {ReadMcpRootInput} from "./contract/input"
import type {ReadMcpRootOutput} from "./contract/output"

export type {ReadMcpRootInput, ReadMcpRootOutput}

/**
Добавляет собственное назначение входа к актуальным направлениям каталога.

@param input - Подключённые направления, в том числе пустой список.
@returns Начальный ответ с label, description и children, без привязки к проекту.
*/
export function readMcpRoot({entries}: ReadMcpRootInput): ReadMcpRootOutput {
  return readMcpChildren({
    label: "Вход Storybook MCP",
    description: "Выберите подключённый проект, компонент или библиотеку по описанию. Для перехода передайте path выбранного элемента children в следующий вызов storybook. Выбранный владелец раскрывает input и output как JSON Schema с описаниями. Пустой вызов возвращает к этому входу.",
    entries,
  })
}
