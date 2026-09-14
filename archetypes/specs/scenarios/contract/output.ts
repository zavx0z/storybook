/**
Значение в переносимом снимке данных.

Повторные объекты и циклы представлены {$type: "reference", path: [...]},
где path содержит ключи и индексы от корня текущего снимка; [] обозначает корень.
Снимки args, outcome.value и outcome.error независимы.
Объект источника с собственным $type представлен {$type: "object", value: {...}};
это отличает пользовательские данные от служебных меток.
Полное описание формата находится в notes/value-format.md.
*/
type TraceValue =
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
type TraceOutcome =
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
interface TraceLocation {
  readonly path: string
  readonly line: number
  readonly column: number
}

/**
Один наблюдённый вызов public function.

@property id - Порядковый номер начала вызова в дочернем процессе.

@property completed - Порядковый номер фактического завершения вызова.

@property module - Разрешённый путь импортированного модуля сценария.

@property name - Имя export или выбранного метода в форме `export.method`.

@property describe - Иерархия фактических group names от внешней к внутренней.

@property test - Имя текущего test или `null` для вызова в callback describe.

@property args - Снимок фактических позиционных аргументов.
Ссылки внутри аргументов разрешаются от корня этого массива.

@property outcome - Результат или ошибка с различением sync и Promise.
Ссылки в value или error разрешаются от корня соответствующего значения.

@property location - Первый caller frame вне preload implementation.
*/
interface TraceCall {
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

/** Фактически достигнутое утверждение expect с данными и исходом matcher. */
interface ScenarioAssertion {
  readonly id: number
  readonly site: string
  readonly describe: readonly string[]
  readonly test: string | null
  readonly testId: number | null
  readonly customFailMessage: string | null
  readonly actual: TraceValue
  readonly matcher: string
  readonly modifiers: readonly string[]
  readonly expected: readonly TraceValue[]
  readonly status: "passed" | "failed"
  readonly error: TraceValue | null
  readonly location: TraceLocation | null
}

/** Группа, зарегистрированная исходным describe, с сохранением вложенности. */
interface ScenarioGroup {
  readonly id: number
  readonly parentId: number | null
  readonly label: string
  readonly parameters: TraceValue
  readonly location: TraceLocation
  readonly mode: "run" | "skip" | "todo"
  readonly skipReason: string | null
}

/** Тест из исходного сценария и его состояние в штатном отчёте Bun. */
interface ScenarioTest {
  readonly id: number
  readonly groupId: number | null
  readonly label: string
  readonly location: TraceLocation
  readonly mode: "run" | "skip" | "todo"
  readonly status: "passed" | "failed" | "skipped" | "todo" | "not-executed" | "error"
  readonly message: string | null
  readonly skipReason: string | null
  readonly assertions: readonly {
    readonly site: string
    readonly location: TraceLocation
    readonly source: string
    readonly customFailMessage: string | null
  }[]
}

/**
Результат отдельного запуска настоящего Bun Test.

Общие исходные данные для валидации, MCP и приложения. Форматирование,
фильтрация и сворачивание для конкретного представления выполняются потребителем.

@property path - Абсолютный путь исполненного файла.

@property exitCode - Код завершения дочернего Bun Test.

@property stdout - Стандартный вывод дочернего процесса.

@property stderr - Диагностический вывод дочернего процесса.

@property calls - Вызовы в порядке их начала, а не завершения Promise.
@property assertions - Достигнутые expect в порядке обращения, с отдельным исходом каждого matcher.
@property groups - Зарегистрированные группы с параметрами вариантов и родительскими идентификаторами.
@property tests - Объявления пунктов, исходные expect и состояния из штатного JUnit Bun.
@property junit - Полный неизменённый XML штатного отчёта этого же запуска.
*/
export interface ReadScenarioOutput {
  readonly path: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly calls: readonly TraceCall[]
  readonly assertions: readonly ScenarioAssertion[]
  readonly groups: readonly ScenarioGroup[]
  readonly tests: readonly ScenarioTest[]
  readonly junit: string
}
