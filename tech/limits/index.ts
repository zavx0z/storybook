/**
Предоставляет настройки удержания HTTP без ограничения длительности предметной работы.
Ожидание конкретного клиента задаётся отдельно; оно не определяет корректность
работы и не заменяет её события прогресса.

@packageDocumentation
*/
import type {StorybookTechLimits} from "./contract"
export type {StorybookTechLimits} from "./contract"

/** Общая политика временных бюджетов без запуска процессов при чтении. */
const limits: StorybookTechLimits.Output = Object.freeze({
  STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS: 125,
})

export default limits
