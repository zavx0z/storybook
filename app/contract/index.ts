import type {AppWeb} from "@app/web"

/** Контракт управления приложением; части сохраняют собственные типы. */
export declare namespace StorybookApp {
  /** Готовые возможности обслуживания Web, подключаемые контейнером. */
  type Input<Prepared> = Readonly<{web: AppWeb.Input<Prepared>}>

  /** Управляющий API целого для явного перевыпуска Web и наблюдения его состояния. */
  type Output = Readonly<{
    rebuildWeb: AppWeb.Output["rebuild"]
    status(): Readonly<{web: ReturnType<AppWeb.Output["read"]>}>
    subscribe: AppWeb.Output["subscribe"]
    dispose(): Promise<void>
  }>
}
