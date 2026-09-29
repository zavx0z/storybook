/**
Применение нормативного стандарта к одному реальному пакету.

@property path - Физический корень проверяемого пакета; класс не передаётся.
@property [signal] - Отмена всей последовательности проверок.
*/
export interface ReadAssessmentInput {
  readonly path: string
  readonly signal?: AbortSignal
}
