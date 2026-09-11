import {StorybookBuildScheduler} from "./build-scheduler.ts"

export {
  STORYBOOK_BUILD_CONCURRENCY,
  STORYBOOK_BUILD_CONCURRENCY_MAX,
} from "./build-scheduler.ts"

/**
Совместимое имя общего build scheduler.

Новые интеграции используют {@link StorybookBuildScheduler} и его operation
snapshot. Фасад сохраняет прежние `run`, `acquire`, `active` и `pending`.
*/
export class StorybookBuildSemaphore extends StorybookBuildScheduler {}

export function storybookAbortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason
  return new DOMException(reason === undefined ? "Storybook operation aborted" : String(reason), "AbortError")
}
