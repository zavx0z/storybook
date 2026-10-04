import type ProcessResourceSampler from "@storybook-tech-process/sample"
import type {BuildCompletion, BuildOperation} from "./operation"

/** Допуск работ и наблюдение их состояния при сохранении типа данных владельца. */
export declare namespace StorybookTechBuildQueue {
  /**
  Настройки одной очереди сборочных работ и явного измерения ресурсов.

  @property [limit=1] - Одновременно исполняемые работы, целое от 1 до 8.
  @property [recentLimit=32] - Сохраняемые завершения, целое от 0 до 256.
  @property [resourceSampleThrottleMs=1000] - Минимальный интервал измерений в мс.
  @property [resourceSampler] - Источник снимка по явному запросу; фонового опроса нет.
  @property [now] - Часы Unix в миллисекундах для всех переходов.
  @property [isTimeout] - Распознаёт ошибку бюджета; по умолчанию имя TimeoutError.
  */
  type Input = Readonly<{
    limit?: number
    recentLimit?: number
    resourceSampleThrottleMs?: number
    resourceSampler?: Pick<InstanceType<typeof ProcessResourceSampler>, "sample">
    now?: () => number
    isTimeout?: (error: unknown, signal: AbortSignal) => boolean
  }>

  /**
  Снимок очереди с исходным типом данных каждой работы.

  @typeParam Details - Данные работы, принадлежащие вызывающей стороне.
  @property sampledAt - Момент общего снимка в ISO 8601.
  @property limit - Действующий предел исполнителей.
  @property activeCount - Работы, ещё удерживающие slot.
  @property queuedCount - Работы, ожидающие допуска.
  @property active - Исполнение и подтверждаемая отмена.
  @property queued - Ожидание в порядке поступления.
  @property recent - Завершения, новые впереди.
  */
  type Output<Details extends object> = Readonly<{
    sampledAt: string
    limit: number
    activeCount: number
    queuedCount: number
    active: readonly BuildOperation<Details>[]
    queued: readonly BuildOperation<Details>[]
    recent: readonly BuildCompletion<Details>[]
  }>
}
