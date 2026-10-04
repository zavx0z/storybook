import type {StorybookPackageRouteResolve} from "@storybook-package-route/resolve"

/** Контракт чтения одного уровня структурной навигации. */
export declare namespace StorybookPackageRouteChildren {
  /** Базовый адрес без варианта и список зарегистрированных корней. */
  type Input = Readonly<{
    route: string
    roots: StorybookPackageRouteResolve.Input["roots"]
  }>

  /** Разрешённые непосредственные дети в порядке авторской структуры. */
  type Output = readonly NonNullable<StorybookPackageRouteResolve.Output>[]
}
