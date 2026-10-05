/** Публичный отказ без приватного контекста транспорта. */
export type Failure = Readonly<{code: string, message: string, details?: unknown}>

/**
Событие одного вызова, предназначенное общему журналу и истории исполнения.

@property id - Identity, созданная средой; одинакова во всех фазах вызова.

@property executorId - Источник вызова, который задаёт назначение хоста.

@property address - Предмет источника, независимо от пути чтения или цели инспекции.

@property arguments - Копия аргументов команды; наблюдатель не изменяет исполнение.

@property startedAt - Начало вызова в миллисекундах Unix time.

@property durationMs - Наблюдаемая длительность завершённого вызова; null до завершения.

@property phase - Начало, промежуточный progress, успешный результат или подтверждённый отказ.
Bearer и назначенная директория в событии отсутствуют.
*/
export type CallEvent = Readonly<{
  id: string
  executorId: string
  address: string
  name: string
  arguments: Readonly<Record<string, unknown>>
  startedAt: number
}> & (
  | Readonly<{phase: "running", durationMs: null}>
  | Readonly<{phase: "progress", durationMs: number, progress: Readonly<Record<string, unknown>>}>
  | Readonly<{phase: "success", durationMs: number, result: Readonly<Record<string, unknown>>}>
  | Readonly<{phase: "failed", durationMs: number, error: Failure}>
)
