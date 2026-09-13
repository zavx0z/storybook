/** Значение, переносимое из дочернего Bun без потери JSON primitives. */
export type TraceValue =
  | null
  | boolean
  | number
  | string
  | readonly TraceValue[]
  | {readonly [key: string]: TraceValue}

/**
Исход одного фактического вызова.

`resolve` и `reject` фиксируют значение только после завершения Promise.
*/
export type TraceOutcome =
  | {readonly type: "return", readonly value: TraceValue}
  | {readonly type: "resolve", readonly value: TraceValue}
  | {readonly type: "throw", readonly error: TraceValue}
  | {readonly type: "reject", readonly error: TraceValue}

/**
Исходная точка вызова наблюдаемого export.

@property path - Абсолютный путь или имя источника из stack frame.

@property line - Номер строки с единицы.

@property column - Номер колонки с единицы.
*/
export interface TraceLocation {
  readonly path: string
  readonly line: number
  readonly column: number
}

/**
Один наблюдённый вызов public function.

@property id - Порядковый номер начала вызова в дочернем процессе.

@property completed - Порядковый номер фактического завершения вызова.

@property module - Модуль, выбранный входным контрактом.

@property name - Имя вызванного export.

@property describe - Иерархия фактических group names от внешней к внутренней.

@property test - Имя текущего test или `null` для вызова в callback describe.

@property args - Снимок фактических позиционных аргументов.

@property outcome - Результат или ошибка с различением sync и Promise.

@property location - Первый caller frame вне preload implementation.
*/
export interface TraceCall {
  readonly id: number
  readonly completed: number
  readonly module: string
  readonly name: string
  readonly describe: readonly string[]
  readonly test: string | null
  readonly args: readonly TraceValue[]
  readonly outcome: TraceOutcome
  readonly location: TraceLocation | null
}

/**
Результат отдельного запуска настоящего Bun Test.

@property path - Абсолютный путь исполненного файла.

@property exitCode - Код завершения дочернего Bun Test.

@property stdout - Стандартный вывод дочернего процесса.

@property stderr - Диагностический вывод дочернего процесса.

@property calls - Вызовы в порядке их начала, а не завершения Promise.
*/
export interface TraceScenarioOutput {
  readonly path: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly calls: readonly TraceCall[]
}
