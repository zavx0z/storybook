import type {WebWorkbenchModel} from "@web/workbench-model"

/** Вход рабочей области в существующем Experience. */
export declare namespace WebWorkbench {
  /**
  @property model - Общая модель с полным каталогом и атомарной публикацией содержимого.
  @property displayId - Display того же Experience, содержащий рабочую область.
  @property hudId - HUD того же Experience для экранной проекции.
  @property onReady - Получает управление существующими узлами после монтажа.
  */
  export type Input = Readonly<{
    mcpOpen?: boolean | undefined
    onMcpOpenChange?: ((open: boolean) => void) | undefined
    model: WebWorkbenchModel.Output
    displayId: string
    hudId: string
    onReady(workbench: ReturnType<WebWorkbenchModel.Output["bind"]>): void
  }>

}
