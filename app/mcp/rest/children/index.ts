/**
Формирует единый навигационный ответ из авторских сведений общего каталога.
Не определяет содержимое по npm-упаковке и не выполняет файловый discovery.

@packageDocumentation
*/
import type {McpChildren} from "./contract"
import {navigationLabel} from "./src/label"

export type {McpChildren} from "./contract"

/**
Возвращает текущий контекст и только его непосредственных детей в порядке каталога.
Назначение description стоит первым и у текущего контекста, и у каждого ребёнка.

@param input - Авторское название, назначение и доступные адреса.
@returns Новый ответ без изменения входных данных и без раскрытия соседних ветвей.
*/
export default function readMcpChildren({path, label, description, entries}: McpChildren.Input): McpChildren.Output {
  const describe = (value: string) => value.trim().length > 0 ? value : "Описание не задано владельцем."
  const currentLabel = navigationLabel(path, label, description)
  return {
    description: describe(description),
    ...(path === undefined ? {} : {path}),
    ...(currentLabel === undefined ? {} : {label: currentLabel}),
    children: entries.filter(entry => entry.parent === (path ?? null))
      .map(entry => {
        const description = describe(entry.summary ?? entry.description).split(/\n\s*\n/u)[0]!
        const childLabel = navigationLabel(entry.path, entry.label, description)
        return {description, path: entry.path, ...(childLabel === undefined ? {} : {label: childLabel})}
      }),
  }
}
