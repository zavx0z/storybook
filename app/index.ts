/**
Контейнер Storybook соединяет возможности частей и управляет их жизненным циклом.
Явный перевыпуск Web использует готовую платформу и единую операцию для человека
и агента. Состояние подготовки отличается от публикации; применение в страницах
подтверждается HMR отдельно. Перенос запуска Server и MCP ещё не завершён.

@packageDocumentation
*/
import createWeb from "@app/web"
import type {StorybookApp} from "./contract"
export type {StorybookApp} from "./contract"

/** Создаёт управление Web в составе приложения без запуска компиляции при создании. */
export default function createApp<Prepared>(input: StorybookApp.Input<Prepared>): StorybookApp.Output {
  const web = createWeb(input.web)
  return Object.freeze({
    rebuildWeb: options => web.rebuild(options),
    status: () => Object.freeze({web: web.read()}),
    subscribe: listener => web.subscribe(listener),
    dispose: () => web.dispose(),
  })
}
