import type {
  StorybookBuildOperationContext,
  StorybookBuildRequest,
  StorybookBuildSchedulerOptions,
  StorybookBuildSchedulerSnapshot,
  StorybookBuildTransitionListener,
} from "./types"

/** Контракт допуска и наблюдения package/shared build operations. */
export declare namespace StorybookPackageBuildScheduler {
  /** Число одновременных работ либо настройки очереди, измерения и времени. */
  type Input = number | StorybookBuildSchedulerOptions

  /**
  Одна очередь с проверенными package-job причинами, фазами и результатами.

  @property active - Число работ, удерживающих слот до очистки.

  @property pending - Число работ в очереди допуска.

  @property subscribe - Подписывает на переходы; возвращённая функция удаляет
  listener, а его исключение не останавливает работу.

  @property run - Передаёт работу технической очереди; отмена signal отделяет
  ожидание и освобождает слот после завершения cleanup. Вариант с request
  сохраняет package identity и предоставляет контекст фаз исполнителю.

  @property acquire - Получает низкоуровневый слот и возвращает одно освобождение.

  @property snapshot - Читает текущую очередь и ограниченную историю;
  `sampleResources: true` явно включает измерение процесса.

  @property dispose - Закрывает очередь ожидания, сохраняя cleanup уже запущенных работ.
  */
  type Output = Readonly<{
    active: number
    pending: number
    subscribe(listener: StorybookBuildTransitionListener): () => void
    run<Value>(operation: () => Promise<Value>, signal: AbortSignal): Promise<Value>
    run<Value>(request: StorybookBuildRequest, operation: (context: StorybookBuildOperationContext) => Promise<Value>, signal: AbortSignal): Promise<Value>
    acquire(signal: AbortSignal): Promise<() => void>
    snapshot(options?: Readonly<{sampleResources?: boolean}>): StorybookBuildSchedulerSnapshot
    dispose(): void
  }>
}
