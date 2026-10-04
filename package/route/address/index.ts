/**
Строит browser-safe адрес из канонического пути структурного узла.

@packageDocumentation
*/
import type {Zavx0zStorybookPackageRouteAddress} from "./contract"
import {isAddressSegment} from "./src/segment"
import {parseRoute, isRouteRootName} from "./src/parse"

export type {Zavx0zStorybookPackageRouteAddress} from "./contract"

/**
Кодирует каждый сегмент узла отдельно и добавляет выбранный вариант.

@param input - Канонический путь узла и необязательный вариант.
@returns Абсолютный pathname с необязательным query.
@throws TypeError, если путь пуст, содержит служебный сегмент, slash, backslash
или нулевой символ внутри сегмента.
*/
function formatRouteAddress({node, view, variant}: Zavx0zStorybookPackageRouteAddress.Input): string {
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

/** Один browser-safe адресный API с кодированием и разбором. */
const address: Zavx0zStorybookPackageRouteAddress.Output = Object.assign(formatRouteAddress, {parseRoute, isRouteRootName})

export default address
