/**
Входной контракт разрешения структурного маршрута.

@property route - Адрес сущности с необязательным ведущим `/` и
query-параметрами `view` и `variant`.

@property roots - Явно зарегистрированные корни. `name` задаёт первый сегмент
адреса, `path` указывает на директорию корневого пакета.
*/
export interface ResolveRouteInput {
  readonly route: string
  readonly roots: readonly {
    readonly name: string
    readonly path: string
  }[]
}
