import type {Zavx0zStorybookPackageRouteResolve} from "@zavx0z/storybook-package-route-resolve"

/** Контракт чтения одного уровня структурной навигации. */
export declare namespace Zavx0zStorybookPackageRouteChildren {
  /** Базовый адрес без варианта и список зарегистрированных корней. */
  type Input = Readonly<{
    route: string
    roots: Zavx0zStorybookPackageRouteResolve.Input["roots"]
  }>

  /** Разрешённые непосредственные дети в порядке авторской структуры. */
  type Output = readonly NonNullable<Zavx0zStorybookPackageRouteResolve.Output>[]
}
