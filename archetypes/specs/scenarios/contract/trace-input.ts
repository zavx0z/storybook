/**
Выбор экспортов одного модуля для наблюдения.

@property module - Спецификатор модуля, который импортирует сценарий.
Относительный путь разрешается от `cwd` дочернего Bun.

@property exports - Имена public functions, вызовы которых нужно наблюдать.
*/
export interface TraceModuleSelection {
  readonly module: string
  readonly exports: readonly string[]
}

/**
Входной контракт наблюдаемого исполнения сценария.

@property path - Путь к существующему файлу Bun Test.

@property observe - Public module exports, выбранные вызывающим кодом.
*/
export interface TraceScenarioInput {
  readonly path: string
  readonly observe: readonly TraceModuleSelection[]
}
