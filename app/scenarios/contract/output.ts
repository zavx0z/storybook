import type {ValidateScenarioOutput} from "@archetypes/specs/scenarios/validation"

/**
Значение в переносимом снимке данных.

Повторные объекты и циклы представлены меткой `{$type: "reference", path: [...]}`.
`path` содержит ключи и индексы от корня текущего снимка; `[]` обозначает корень.
Снимки `args`, `outcome.value` и `outcome.error` независимы.
Объект источника с собственным `$type` представлен как `{$type: "object", value: {...}}`,
что отличает пользовательские данные от служебных меток.
`NaN`, бесконечности и `-0` представлены меткой `number` со строковым `value`.
Для `RegExp` сохраняются `source`, `flags`, `lastIndex` и дополнительные свойства
в `properties` при их наличии.

Полный набор меток описан в [формате снимков значений](../notes/value-format.md).
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

`return` содержит синхронно возвращённое значение, `throw` — синхронную ошибку.
`resolve` и `reject` фиксируют значение или ошибку после завершения `Promise`.

@property type - Способ завершения вызова.

@property value - Снимок значения для ветвей `return` и `resolve`.

@property error - Снимок ошибки для ветвей `throw` и `reject`.
*/
type TraceOutcome =
  | {readonly type: "return", readonly value: TraceValue}
  | {readonly type: "resolve", readonly value: TraceValue}
  | {readonly type: "throw", readonly error: TraceValue}
  | {readonly type: "reject", readonly error: TraceValue}

/**
Положение наблюдаемого вызова или объявления в исходнике.

@property path - Абсолютный путь либо имя источника из записи стека вызовов.

@property line - Номер строки, начиная с единицы.

@property column - Номер столбца, начиная с единицы.
*/
interface TraceLocation {
  readonly path: string
  readonly line: number
  readonly column: number
}

/**
Один наблюдённый вызов публичной функции или её метода.

@property id - Порядковый номер начала вызова в дочернем процессе.

@property completed - Порядковый номер фактического завершения вызова.

@property module - Разрешённый путь импортированного модуля сценария.

@property name - Имя экспорта или выбранного метода в форме `export.method`.

@property groupId - Идентификатор варианта или вложенной группы, в которой начался вызов,
либо `null`, если вызов не связан с группой.

@property describe - Названия фактических групп от внешней к внутренней.

@property test - Имя текущего `test` либо `null`, в частности для вызова из тела `describe`.

@property args - Снимок позиционных аргументов. Ссылки внутри аргументов разрешаются
от корня этого массива.

@property outcome - Результат или ошибка {@link TraceOutcome} с различением синхронного
выполнения и завершения `Promise`. Ссылки разрешаются от корня `value` или `error`.

@property location - Первая запись стека вызывающего кода вне предварительно загруженного
механизма наблюдения либо `null`, если положение не определено.
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
Подготовленное представление вариантов одного компонента.

@property kind - Признак компонентного представления `component`.

@property module - Общая тестовая заготовка, объявляющая JSX компонента.
`path` обозначает путь к модулю, `export` — имя экспортируемой заготовки.

@property variants - Варианты внешнего `describe.each` в порядке показа.
Каждый содержит идентификатор `id`, название `title`, фактические свойства `props`,
подготовленный исходник `source` и пункты `points` с заголовком и пояснением при наличии.
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
Снимки вызовов функции без исполняемого браузерного модуля.

Статически подтверждённые импортированные значения сохраняются в `source`
как именованные ссылки с исходным `import`, а не преобразуются в JSON.

@property kind - Признак представления функции `function`.

@property variants - Именованные варианты с исходником `source`, пунктами `points`
и вызовами `calls`. Каждый вызов содержит идентификатор, исходник и {@link TraceOutcome}.
Необязательные `props` сохраняют JSON-поля исходных свойств для повторного запуска;
исполняемые значения остаются в тесте.
*/
interface FunctionScenarioPreview {
  readonly kind: "function"
  readonly variants: readonly {
    readonly id: string
    readonly title: string
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

/**
Подготовленные данные просмотра: компонент монтируется из тестовой заготовки,
функция показывается по сохранённым исходам вызовов.
Поле `kind` различает {@link ComponentScenarioPreview} и {@link FunctionScenarioPreview}.
*/
type ScenarioPreview = ComponentScenarioPreview | FunctionScenarioPreview

/**
Фактически достигнутая проверка `expect`, её данные и исход.

@property id - Идентификатор выполненной проверки.

@property site - Идентификатор места проверки в исходнике.

@property describe - Названия групп от внешней к внутренней.

@property test - Имя текущего теста либо `null` вне теста.

@property testId - Идентификатор текущего теста либо `null` вне теста.

@property customFailMessage - Авторское пояснение рядом с `expect` либо `null` при его отсутствии.

@property actual - Снимок фактического проверяемого значения.

@property matcher - Имя применённого метода проверки, например `toEqual`.

@property modifiers - Модификаторы проверки в порядке обращения.

@property expected - Снимки аргументов метода проверки.

@property status - Итог этой проверки: `passed` или `failed`.

@property error - Снимок ошибки проверки либо `null` при её отсутствии.

@property location - Положение проверки в исходнике либо `null`, если оно не определено.
*/
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

/**
Группа, зарегистрированная исходным `describe`, с сохранением вложенности.

@property id - Идентификатор зарегистрированной группы.

@property parentId - Идентификатор родительской группы либо `null` для внешнего уровня.

@property label - Фактическое название группы.

@property parameters - Снимок параметров зарегистрированного варианта.

@property location - Положение объявления группы в исходнике.

@property mode - Режим регистрации: выполнение, пропуск или незавершённая группа.

@property skipReason - Причина пропуска либо `null`, если она не указана.
*/
interface ScenarioGroup {
  readonly id: number
  readonly parentId: number | null
  readonly label: string
  readonly parameters: TraceValue
  readonly location: TraceLocation
  readonly mode: "run" | "skip" | "todo"
  readonly skipReason: string | null
}

/**
Тест из исходного сценария и его состояние в штатном отчёте Bun.

@property id - Идентификатор зарегистрированного теста.

@property groupId - Идентификатор содержащей группы либо `null` для внешнего уровня.

@property label - Фактическое название теста.

@property location - Положение объявления теста в исходнике.

@property mode - Объявленный режим: `run`, `skip` или `todo`.

@property status - Итог: успех, провал, пропуск, незавершённость, отсутствие выполнения
или ошибка. Режим регистрации и результат выполнения не подменяют друг друга.

@property message - Сообщение об исходе теста либо `null` при его отсутствии.

@property skipReason - Причина пропуска либо `null`, если она не указана.

@property assertions - Объявления проверок: место `site`, положение `location`,
исходник `source` и авторское пояснение `customFailMessage`.
Наличие объявления не означает, что проверка была достигнута при выполнении.
*/
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
Структура исходника до выполнения: фрагменты документации и сведения для проверки правил.

@property path - Путь к прочитанному файлу сценария.

@property text - Полный текст исходника.

@property native - Использованные штатные средства тестового API.

@property imports - Обнаруженные импорты исходника.

@property assertions - Исходные выражения проверок, их пояснения, признак непосредственного
описания рядом с данными и положение в файле.

@property tests - Объявления тестов с названиями, числом проверок, исходником,
положением и признаками параметризации, пропуска и незавершённости.

@property groups - Объявления групп: исходник, заголовок, подготовка, глубина
вложенности и признак параметризации.

@property checks - Фрагменты вызова методов проверки и признак явно заданного объекта
в ожидаемом условии.

@property hooks - Имена и исходники обработчиков жизненного цикла тестов.

@property registrations - Места регистрации `describe` и `test`: названия, модификаторы,
вложенность, область объявления, замечания и положение в файле.
*/
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

/**
Результат отдельного запуска настоящего Bun Test.

Это общие исходные данные для проверки правил, MCP и приложения.
Форматирование, фильтрацию и сворачивание для конкретного представления выполняет потребитель.

@property path - Абсолютный путь выполненного файла.

@property exitCode - Код завершения дочернего процесса Bun Test.

@property stdout - Стандартный вывод дочернего процесса.

@property stderr - Диагностический вывод дочернего процесса.

@property calls - Вызовы {@link TraceCall} в порядке начала, а не завершения `Promise`.

@property assertions - Достигнутые проверки {@link ScenarioAssertion} в порядке обращения,
с отдельным итогом каждой проверки.

@property groups - Зарегистрированные группы с параметрами и родительскими идентификаторами.

@property tests - Объявления тестов, исходные проверки и состояния из штатного отчёта JUnit Bun.

@property junit - Полный неизменённый XML штатного отчёта этого же запуска.

@property source - Структура и фрагменты выполненного исходника {@link ScenarioSource}.

@property validation - Результат проверки правил {@link ValidateScenarioOutput};
нереализованные проверки обозначены явно.

@property [preview] - Представление {@link ScenarioPreview}: компонент с общей тестовой
заготовкой либо снимки прямых вызовов публичной функции описываемой сущности.
Серверный код не передаётся в браузер для повторного выполнения.
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
  readonly validation: ValidateScenarioOutput
  readonly preview?: ScenarioPreview
}
