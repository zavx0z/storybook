import type {Contract as Web} from "@app/web"

/** Готовые возможности обслуживания Web, подключаемые контейнером. */
export type Input<Prepared> = Readonly<{web: Web.Input<Prepared>}>

/** Управляющий API целого для явного перевыпуска Web и наблюдения его состояния. */
export type Output = Readonly<{
  rebuildWeb: Web.Output["rebuild"]
  status(): Readonly<{web: ReturnType<Web.Output["read"]>}>
  subscribe: Web.Output["subscribe"]
  dispose(): Promise<void>
}>
