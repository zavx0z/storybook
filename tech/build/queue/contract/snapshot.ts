import type {BuildCompletion, BuildOperation} from "./operation"

/**
Состояние очереди в один момент времени. Чтение не создаёт новых работ.

@property sampledAt - Момент общего снимка в ISO 8601.

@property limit - Действующий предел одновременно исполняемых работ.

@property activeCount - Число работ, ещё удерживающих slot.

@property queuedCount - Число ожидающих допуска работ.

@property active - Исполнение и подтверждаемая отмена.

@property queued - Ожидание в порядке поступления.

@property recent - Ограниченная история завершений, новые впереди.
*/
export interface BuildQueueSnapshot<Details extends object> {
  readonly sampledAt: string
  readonly limit: number
  readonly activeCount: number
  readonly queuedCount: number
  readonly active: readonly BuildOperation<Details>[]
  readonly queued: readonly BuildOperation<Details>[]
  readonly recent: readonly BuildCompletion<Details>[]
}
