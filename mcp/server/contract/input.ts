import type {ExternalStorybookController} from "../../../server/controller-contract.ts"
import type {requestStorybook} from "../../proxy"
import type {recordMcpRequest} from "../src/request-log"

/**
Зависимости MCP-сервера: передача HTTP-запросов, управление и журналирование.

Контракты предметных ответов остаются на HTTP-сервере.

@property [controller] - Готовый {@link ExternalStorybookController} для управляющих
инструментов и ресурсов. Имеет приоритет перед фабрикой.

@property [controllerFactory] - Отложенное создание управляющего контроллера,
если готовый контроллер не передан. Проксирование предметного запроса его не загружает.
Без обеих зависимостей используется контроллер самого Storybook.

@property [request] - Передача предметного запроса HTTP-серверу.
Без замены используется {@link requestStorybook}.

@property [recordRequest] - Запись этапов и исходов запросов в журнал.
Без замены используется {@link recordMcpRequest}.
*/
export interface CreateStorybookMcpServerInput {
  readonly controller?: ExternalStorybookController
  readonly controllerFactory?: () => ExternalStorybookController | Promise<ExternalStorybookController>
  readonly request?: typeof requestStorybook
  readonly recordRequest?: typeof recordMcpRequest
}
