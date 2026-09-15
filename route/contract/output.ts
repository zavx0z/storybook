/**
Результат разрешения структурного маршрута либо `null` для неизвестного или
недоступного адреса.

@property node - Канонический путь узла без ведущего `/` и query.

@property pathname - Канонический URL pathname с ведущим `/`.

@property directory - Физическая директория выбранного владельца.

@property package - Идентичность непосредственного пакета и его физический корень.

@property relativePath - Логический путь выбранного владельца внутри пакета.

@property view - Выбранное structural представление либо exact authored
category, subject или variant presentation `story`.

@property views - Доступные file-backed представления непосредственного владельца.

@property [variant] - Выбранный query-параметром вариант.
*/
export type ResolveRouteOutput = {
  readonly node: string
  readonly pathname: string
  readonly directory: string
  readonly package: {
    readonly id: string
    readonly path: string
  }
  readonly relativePath: string
  readonly view: "overview" | "scenarios" | "contract" | "dependencies" | "story"
  readonly views: readonly ("scenarios" | "contract" | "dependencies")[]
  readonly variant?: string
} | null
