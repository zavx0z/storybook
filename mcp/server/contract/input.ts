import type {ExternalStorybookController} from "../../../server/controller-contract.ts"
import type {requestStorybook} from "../../proxy"
import type {recordMcpRequest} from "../src/request-log"

/** Подключаемые транспорт и управляющий контроллер, без контрактов предметных HTTP-ответов. */
export interface CreateStorybookMcpServerInput {
  readonly controller?: ExternalStorybookController
  readonly controllerFactory?: () => ExternalStorybookController | Promise<ExternalStorybookController>
  readonly request?: typeof requestStorybook
  readonly recordRequest?: typeof recordMcpRequest
}
