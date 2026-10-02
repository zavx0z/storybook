/**
Предоставляет начальные сохраняемые настройки Minimap.
Каждый вызов возвращает новую раскладку; ответы, каталог и временные жесты
не входят в состояние. Сохранением и восстановлением настроек владеет приложение.

@packageDocumentation
*/
import type {MinimapState} from "./contract"
export type {MinimapState} from "./contract"

/** Начальная раскладка Minimap до первого сохранения настроек. */
export default function defaultMinimapState(): MinimapState.Output {
  return {collapsed: false, geometry: {x: 8, y: 8, width: 300, height: 480}, tab: {edge: "left", offset: .5}}
}
