/**
Предоставляет конечные бюджеты компиляции, выполнения сценария, запуска процесса и удержания HTTP.
Ожидание конкретного клиента задаётся отдельно; оно не определяет корректность
работы и не заменяет её события прогресса.

@packageDocumentation
*/
import type {TechLimits} from "./contract"
export type {TechLimits} from "./contract"

const packageCompileTimeout = 120_000

/** Общая политика временных бюджетов без запуска процессов при чтении. */
const limits: TechLimits.Output = Object.freeze({
  STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS: packageCompileTimeout,
  STORYBOOK_SCENARIO_TIMEOUT_MS: packageCompileTimeout + 30_000,
  STORYBOOK_SHARED_COMPILE_TIMEOUT_MS: 480_000,
  STORYBOOK_SERVER_START_TIMEOUT_MS: 120_000,
  STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS: 125,
})

export default limits
