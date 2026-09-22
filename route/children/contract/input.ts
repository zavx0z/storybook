/**
Входной контракт чтения непосредственных дочерних маршрутов.

@property route - Базовый адрес владельца без варианта и дополнительного представления `view`;
пустая строка или `/` выбирает список корней.

@property roots - Явно зарегистрированные корни с именем первого сегмента.
*/
export interface ReadRouteChildrenInput {
  readonly route: string
  readonly roots: readonly {
    readonly name: string
    readonly path: string
  }[]
}
