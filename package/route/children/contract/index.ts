import type {RouteResolve} from "@route/resolve"

/** Контракт чтения одного уровня структурной навигации. */
export declare namespace RouteChildren {
  /** Базовый адрес без варианта и список зарегистрированных корней. */
  type Input = Readonly<{
    route: string
    roots: RouteResolve.Input["roots"]
  }>

  /** Разрешённые непосредственные дети в порядке авторской структуры. */
  type Output = readonly NonNullable<RouteResolve.Output>[]
}
