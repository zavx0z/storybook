import type {Workbench, WorkbenchAddressMap, WorkbenchUserState, NavigationExpansion} from "./workbench"

/** Вход рабочей области в существующем Experience. */
export declare namespace StorybookAppWebPageShellWorkbench {
  /**
  @property [initial] - Начальные данные каталога, просмотра и строки состояния.
  @property [userState] - Сохранённое состояние Inspector этой рабочей области.
  @property [navigationExpansion] - Общее управление раскрытием навигации.
  @property displayId - Display того же Experience, содержащий рабочую область.
  @property hudId - HUD того же Experience для экранной проекции.
  @property onReady - Получает управление существующими узлами после монтажа.
  */
  export type Input = Readonly<{
    mcpOpen?: boolean | undefined
    onMcpOpenChange?: ((open: boolean) => void) | undefined
    initial?: Partial<WorkbenchAddressMap> | undefined
    userState?: WorkbenchUserState | undefined
    navigationExpansion?: NavigationExpansion | undefined
    displayId: string
    hudId: string
    onReady(workbench: Output): void
  }>

  /** Смонтированная рабочая область с управлением и подпиской для её HUD-представлений. */
  export type Output = Workbench
}
