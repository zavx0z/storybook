/**
Значение в переносимом снимке данных.

Повторные объекты и циклы представлены {$type: "reference", path: [...]},
где path содержит ключи и индексы от корня текущего снимка; [] обозначает корень.
Снимки args, outcome.value и outcome.error независимы.
Объект источника с собственным $type представлен {$type: "object", value: {...}};
это отличает пользовательские данные от служебных меток.
Полное описание формата находится в notes/value-format.md.
NaN, бесконечности и -0 представлены меткой number со строковым value.
RegExp сохраняет source, flags, lastIndex и дополнительные properties при наличии.
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

@property groupId - Идентификатор фактического варианта или вложенной группы,
в контексте которой начался вызов.

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
  readonly groupId: number | null
  readonly describe: readonly string[]
  readonly test: string | null
  readonly args: readonly TraceValue[]
  readonly outcome: TraceOutcome
  readonly location: TraceLocation | null
}

/**
Данные одного компонента для просмотра исполненных вариантов сценария.

@property module - Общая fixture, которая объявляет JSX компонента.

@property variants - Варианты внешнего `describe.each` с фактическими props,
готовым исходником JSX и пунктами сценария.
*/
interface ComponentScenarioPreview {
  readonly kind: "component"
  readonly module: {
    readonly path: string
    readonly export: string
  }
  readonly variants: readonly {
    readonly id: string
    readonly title: string
    readonly props: Readonly<Record<string, unknown>>
    readonly source: string
    readonly points: readonly {
      readonly title: string
      readonly content?: string
    }[]
  }[]
}

/**
Снимки вызовов функции; исполняемого браузерного модуля здесь нет.
Статически подтверждённые импортированные значения сохраняются в source как
именованные ссылки с исходным import, а не преобразуются в JSON.
*/
interface FunctionScenarioPreview {
  readonly kind: "function"
  readonly variants: readonly {
    readonly id: string
    readonly title: string
    /** JSON-поля исходных props для повторного запуска; исполняемые значения остаются в тесте. */
    readonly props?: Readonly<Record<string, unknown>>
    readonly source: string
    readonly points: ComponentScenarioPreview["variants"][number]["points"]
    readonly calls: readonly {
      readonly id: number
      readonly source: string
      readonly outcome: TraceOutcome
    }[]
  }[]
}

/** Компонент монтируется из fixture, функция показывается по сохранённым вызовам. */
type ScenarioPreview = ComponentScenarioPreview | FunctionScenarioPreview

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

/** Структура исходника до выполнения, включая фрагменты для документации и факты для валидации. */
interface ScenarioSource {
  readonly path: string
  readonly text: string
  readonly native: readonly string[]
  readonly imports: readonly string[]
  readonly assertions: readonly {
    readonly actual: string
    readonly message: string | null
    readonly inline: boolean
    readonly location: TraceLocation
  }[]
  readonly tests: readonly {
    readonly label: string
    readonly assertions: number
    readonly todo: boolean
    readonly skippable: boolean
    readonly source: string
    readonly each: boolean
    readonly location: TraceLocation
  }[]
  readonly groups: readonly {
    readonly source: string
    readonly header: string
    readonly setup: string
    readonly depth: number
    readonly each: boolean
  }[]
  readonly checks: readonly {readonly source: string, readonly matcher: string, readonly explicitObject: boolean}[]
  readonly hooks: readonly {readonly name: string, readonly source: string}[]
  readonly registrations: readonly {
    readonly kind: "describe" | "test"
    readonly label: string
    readonly modifiers: readonly string[]
    readonly depth: number
    readonly scope: "module" | "native" | "helper"
    readonly remarks: string | null
    readonly location: TraceLocation
  }[]
}

/** Результаты применения правил: незавершённые проверки не считаются пройденными. */
interface ScenarioValidation {
  readonly status: "passed" | "failed" | "incomplete"
  readonly checks: readonly {
    readonly rule: string
    readonly status: "passed" | "failed" | "not-checked"
    readonly issues: readonly {
      readonly message: string
      readonly location: TraceLocation | null
    }[]
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
@property source - Структура и фрагменты исполненного исходника.
@property validation - Результаты проверок оформления и выполнения; не реализованные проверки обозначены явно.

@property [preview] - Представление компонента с общей fixture либо снимков прямых
вызовов функции из публичного входа описываемой сущности. Серверный код не передаётся
в браузер для повторного исполнения.
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
  readonly source: ScenarioSource
  readonly validation: ScenarioValidation
  readonly preview?: ScenarioPreview
}
