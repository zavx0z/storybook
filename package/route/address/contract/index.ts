import type {ParsedRoute} from "./parsed"

/** Контракт кодирования и разбора адреса структурного узла. */
export declare namespace RouteAddress {
  /** Канонический путь и необязательные публичные параметры страницы. */
  type Input = Readonly<{
    node: string
    view?: "overview" | "scenarios" | "contract" | "dependencies"
    variant?: string
  }>

  /**
  Вызываемое кодирование адреса и принадлежащая тому же формату проверка.

  @property parseRoute - Декодирует пользовательский адрес с query;
  ошибочная форма возвращает null без обращения к файловой системе.

  @property isRouteRootName - Проверяет имя первого сегмента зарегистрированного корня.
  */
  type Output = ((input: Input) => string) & Readonly<{
    parseRoute(route: string): ParsedRoute | null
    isRouteRootName(name: string): boolean
  }>
}
