import type {ResourceSampler} from "@process/sample"

/**
Настройки ограниченного исполнения работ и наблюдения за их процессами.

@property [limit=1] - Число одновременно исполняемых работ, целое от 1 до 8.

@property [recentLimit=32] - Число сохраняемых завершений, целое от 0 до 256.

@property [resourceSampleThrottleMs=1000] - Минимальный интервал измерений, от 1000 до 60000 мс.

@property [resourceSampler] - Источник снимка процессов; вызывается только при явном запросе измерений.

@property [now] - Часы в миллисекундах Unix, общие для всех переходов очереди.

@property [isTimeout] - Распознавание ошибки бюджета владельцем работы; по умолчанию проверяется имя TimeoutError.
*/
export interface BuildQueueInput {
  readonly limit?: number
  readonly recentLimit?: number
  readonly resourceSampleThrottleMs?: number
  readonly resourceSampler?: ResourceSampler
  readonly now?: () => number
  readonly isTimeout?: (error: unknown, signal: AbortSignal) => boolean
}
