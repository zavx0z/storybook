import type {z} from "zod"
import type {Controller} from "./types"
import type {StorybookPackageMcpTools} from "@zavx0z/storybook-package-mcp-tools"

/** Общая проверенная граница существующих операций приложения. */
export declare namespace StorybookAppControl {
  /**
  Привязка общих команд к публичному контроллеру.

  @property controller - Лениво предоставляет реализацию приложения при первом исполнении.
  Подготовка схем и описаний не обращается к контроллеру и не запускает сервер.

  @property [lifecycle=false] - Добавляет ensure/attach/detach/stop для транспорта с собственным launcher.
  Обычное окружение работающего сервера этих команд не получает.

  @property [resources=true] - Добавляет команду чтения штатного URI ресурса.
  MCP сохраняет собственные resources и прежний каталог при resources:false.
  */
  type Input = Readonly<{
    controller(): Controller | Promise<Controller>
    lifecycle?: boolean
    resources?: boolean
  }>

  /**
  Исполнимые команды и исходные строгие схемы одного состава.

  @property tools - JSON-описания и исполнители, проверяющие аргументы исходным Zod перед dispatch.
  Signal и progress поступают от контекста текущего вызова; результат контроллера сохраняется целиком.

  @property schemas - Те же Zod-схемы для штатной регистрации MCP.
  JSON Schema инструментов описывает форму, а refine/superRefine исполняются общим контролем.
  */
  type Output = Readonly<{
    tools: StorybookPackageMcpTools.Output
    schemas: Readonly<Record<string, z.ZodType>>
  }>
}
