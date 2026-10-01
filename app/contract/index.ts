import type {Contract as Web} from "@app/web"

/** Контракт управления приложением; части сохраняют собственные типы. */
export declare namespace Contract {
  /** Готовые возможности обслуживания Web, подключаемые контейнером. */
  type Input<Prepared> = Readonly<{web: Web.Input<Prepared>}>

  /** Управляющий API целого для явного перевыпуска Web и наблюдения его состояния. */
  type Output = Readonly<{
    rebuildWeb: Web.Output["rebuild"]
    status(): Readonly<{web: ReturnType<Web.Output["read"]>}>
    subscribe: Web.Output["subscribe"]
    dispose(): Promise<void>
  }>
}
