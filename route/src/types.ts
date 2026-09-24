/**
Метаданные package.json, используемые без загрузки кода пакета.

@property name - Публичная package identity.

@property workspaces - Раскрытые существующие пути вложенных пакетов относительно владельца.

*/
export interface PackageManifest {
  readonly name: string
  readonly workspaces: readonly string[]
}

/**
Разобранный и канонизированный пользовательский адрес.

@property segments - Декодированные сегменты pathname.

@property [variant] - Выбранный вариант из query.

@property [view] - Запрошенное дополнительное представление владельца.
*/
export interface ParsedRoute {
  readonly segments: readonly string[]
  readonly variant?: string
  readonly view?: "scenarios" | "contract" | "dependencies"
}

/**
Текущее положение внутри публичной ветки пакета.

@property packageId - Identity ближайшего пакета.

@property packagePath - Физический корень ближайшего пакета.

@property relativeSegments - Логический путь внутри ближайшего пакета.

@property directory - Физическая директория текущего узла.

@property scenarioOwner - Может ли узел владеть immediate scenario spec.

@property moduleOwner - Может ли узел владеть contract и dependency spec.

@property stopsTraversal - Завершает ли узел дальнейший physical traversal.
*/
export interface RoutePosition {
  readonly packageId: string
  readonly packagePath: string
  readonly relativeSegments: readonly string[]
  readonly directory: string
  readonly scenarioOwner: boolean
  readonly moduleOwner: boolean
  readonly stopsTraversal: boolean
}
