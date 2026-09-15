/**
Строит browser-safe адрес из канонического пути структурного узла.

@packageDocumentation
*/
import type {FormatRouteAddressInput} from "./contract/input"
import type {FormatRouteAddressOutput} from "./contract/output"
import {isAddressSegment} from "./src/segment"

export type {FormatRouteAddressInput, FormatRouteAddressOutput}

/**
Кодирует каждый сегмент узла отдельно и добавляет выбранный вариант.

@param input - Канонический путь узла и необязательный вариант.
@returns Абсолютный pathname с необязательным query.
@throws TypeError, если путь пуст, содержит служебный сегмент, slash, backslash
или нулевой символ внутри сегмента.
*/
export function formatRouteAddress({node, view, variant}: FormatRouteAddressInput): FormatRouteAddressOutput {
  const segments = node.split("/")
  if (segments.length === 0 || segments.some(segment => !isAddressSegment(segment))) {
    throw new TypeError("Путь узла содержит недопустимый сегмент")
  }
  if (variant !== undefined && (variant.length === 0 || variant.includes("\0"))) {
    throw new TypeError("Вариант маршрута должен быть непустой строкой без нулевого символа")
  }
  if (view !== undefined && !["overview", "scenarios", "contract", "dependencies"].includes(view)) {
    throw new TypeError("Неизвестное представление маршрута")
  }

  const pathname = `/${segments.map(encodeURIComponent).join("/")}`
  const query: string[] = []
  if (view !== undefined && view !== "overview") query.push(`view=${encodeURIComponent(view)}`)
  if (variant !== undefined) query.push(`variant=${encodeURIComponent(variant)}`)
  return query.length === 0 ? pathname : `${pathname}?${query.join("&")}`
}
