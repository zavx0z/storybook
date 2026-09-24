/**
Результат разрешения структурного маршрута либо `null` для неизвестного
или недоступного адреса.

@property node - Канонический путь узла без ведущего `/` и строки запроса.

@property pathname - Путь в публичном URL с ведущим `/`, без строки запроса.

@property directory - Физическая директория выбранного владельца.

@property package - Непосредственный пакет: `id` обозначает его идентификатор,
`path` — физический корень.

@property relativePath - Логический путь выбранного владельца внутри пакета.

@property view - Выбранное структурное представление либо `story` для представления
явно объявленной категории, предмета или варианта.

@property views - Представления непосредственного владельца, подтверждённые файлами:
сценарии, контракт и зависимости.

@property [variant] - Вариант, выбранный параметром строки запроса.
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
  readonly view: "overview" | "scenarios" | "contract" | "dependencies"
  readonly views: readonly ("scenarios" | "contract" | "dependencies")[]
  readonly variant?: string
} | null
