import type {StorybookSpecsScenariosReaderValidation} from "@zavx0z/storybook-specs-scenarios-reader-validation"

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
Buffer, TypedArray, DataView и буферы представлены меткой `binary`:
`name` задаёт вид значения, `data` содержит все байты видимого среза в base64.
Дополнительные собственные поля сохраняются в `properties`.

Полный набор меток описан в [формате снимков значений](../meta/notes/value-format.md).
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

/** Авторский JSX и импорты для штатной компиляции содержимого варианта. */
interface ScenarioJsx {
  readonly source: string
  readonly imports: readonly {local: string; imported: string; specifier: string; path: string}[]
}

/**
Подготовленное представление вариантов одного компонента.

@property kind - Признак компонентного представления `component`.

@property module - Исходный сценарий и извлечённая из его render декларация JSX.
`path` указывает на сценарий, `source` содержит производный модуль для штатной
компиляции, `export` — его вход. Автор не создаёт отдельную компонентную фикстуру.
Тип props этого модуля выводится TypeScript из параметризации сценария.

@property variants - Параметризованные примеры непосредственного render JSX.
`path` сохраняет вложенность названий describe, `selection` — индексы строк.
Каждый вариант содержит `id`, `title`, входные `props`, исходник использования
`source` и проверяемые пункты `points`. JSX берётся из единственного аргумента
render; значения выбранного варианта подставляются в его выражения.
Значения выбранного варианта раскрываются в соответствующих атрибутах JSX.
Отступ внешнего вызова снимается: корневой тег и его закрытие стоят на одном
уровне, вложенные атрибуты и элементы сохраняют относительные отступы.
Поля подготовленного объекта с однократными прямыми чтениями подставляются
в места использования; общие ссылки сохраняют объявления и identity. Native mock и его журнал
исполняются в Bun; браузер получает поведение callback без тестового наблюдателя.
Результаты проверок и данные вызовов берутся из серверного прогона.
`jsxProps` сохраняет авторские JSX-поля отдельно от JSON-props: исходное выражение
и его импорты с публичным specifier, локальным именем, export и разрешённым путём.
`slots` сохраняет JSX из отдельного объекта slots строки each; отсутствующие слоты не добавляются.
Его ключи обозначают слоты; default — безымянный.
Строка, содержащая только отсутствующий слот, удаляется из показываемого JSX. Слоты не входят в props компонента.
Сборщик компилирует их штатным Template; снимки функций mount/render не исполняются.
Поддержаны парные теги компонента с прямым `{props.children}` и JSX в литерале строки
внешнего describe.each с импортированными компонентами и литеральными параметрами.
Выбор строки сохраняет исходный индекс; переданные JSON-overrides имеют приоритет.
*/
interface ComponentScenarioPreview {
  readonly kind: "component"
  readonly module: {
    readonly path: string
    readonly export: string
    readonly source?: string
  }
  readonly variants: readonly {
    readonly id: string
    readonly title: string
    /** Исходная вложенность названий и индексов describe.each. */
    readonly path?: readonly string[]
    readonly selection?: readonly number[]
    readonly props: Readonly<Record<string, unknown>>
    /** JSX-поля собираются отдельно; compiled templates не сериализуются в props. */
    readonly jsxProps?: Readonly<Record<string, ScenarioJsx>>
    /** Содержимое именованных слотов; default обозначает безымянный; пустые слоты не объявляются. */
    readonly slots?: Readonly<Record<string, ScenarioJsx | null>>
    readonly source: string
    readonly points: readonly {
      readonly title: string
      readonly content?: string
      /** Снимки отдельных expect из того же запуска; выполнение при выборе не повторяется. */
      readonly assertions?: readonly {
        readonly id: string
        readonly label: string
        readonly value: TraceValue
      }[]
    }[]
  }[]
}

/**
Снимки вызовов функции и конструирования default-класса без исполняемого
браузерного модуля.

Статически подтверждённые импортированные значения сохраняются в `source`
как именованные ссылки с исходным `import`, а не преобразуются в JSON.

@property kind - Признак представления результата вызова `function`; прямой `new`
использует ту же форму сохранённого исхода.

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
функция или конструктор показываются по сохранённым исходам вызовов.
Поле `kind` различает {@link ComponentScenarioPreview} и {@link FunctionScenarioPreview}.
*/
type StorybookAppWebPagePackageScenarioPreview = ComponentScenarioPreview | FunctionScenarioPreview

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

@property subject - Описываемая функция или компонент из публичного входа непосредственного владельца.

@property components - JSX-компоненты и происхождение их импортов. public=null означает, что публичность не установлена; локальное объявление имеет module=null и public=false.

@property renders - Вызовы отображения: имя метода, число аргументов и наличие JSX в аргументе.

@property registrations - Места регистрации `describe` и `test`: названия, модификаторы,
вложенность, область объявления, замечания и положение в файле.
*/
interface ScenarioSource {
  readonly subject: {readonly kind: "function" | "component"; readonly module: string; readonly name: string; readonly calls: readonly {readonly location: TraceLocation; readonly variant: TraceLocation | null; readonly test: boolean}[]} | null
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
    readonly location: TraceLocation
    readonly source: string
    readonly header: string
    readonly setup: string
    readonly depth: number
    readonly each: boolean
  }[]
  readonly checks: readonly {readonly source: string, readonly matcher: string, readonly explicitObject: boolean}[]
  readonly hooks: readonly {readonly name: string, readonly source: string}[]
  readonly components: readonly {readonly name: string; readonly module: string | null; readonly public: boolean | null; readonly location: TraceLocation}[]
  readonly renders: readonly {readonly method: string; readonly arguments: number; readonly jsx: boolean; readonly location: TraceLocation}[]
  readonly registrations: readonly {
    readonly kind: "describe" | "test"
    readonly label: string
    readonly modifiers: readonly string[]
    readonly depth: number
    readonly scope: "module" | "native" | "helper" | "indirect"
    readonly remarks: string | null
    /** Явные имена из skipIf, связанного с name строки each; отсутствие означает иной способ выбора. */
    readonly variantNames?: readonly string[] | undefined
    readonly location: TraceLocation
  }[]
}

export declare namespace StorybookSpecsScenariosReader {
  /**
  Условия чтения и выполнения сценария средствами Bun Test.

  @property path - Путь к файлу сценария. Относительный путь разрешается от рабочего
  каталога вызывающего процесса. Импорты и настройки запуска определяются
  по сценарию и его пакету.

  @property [props] - Поля, заменяемые по имени в `props` каждой строки внешнего
  `describe.each`. Остальные поля строки и `props` сохраняются; вложенное значение
  заменяется целиком. Поддерживаются JSON-данные: `null`, строки, логические значения,
  конечные числа кроме `-0`, массивы без пропусков и обычные объекты без вычисляемых
  свойств и циклов. Без `props` используются исходные варианты.
  Без `variantPath` вложенные `describe.each` и `test.each` не изменяются.
  При `variantPath` props заменяются в последней выбранной таблице describe.each.

  @property [testNamePattern] - Штатный фильтр имён групп и тестов Bun.

  @property [variant] - Индекс строки единственного внешнего `describe.each`,
  начиная с нуля. Регистрируется только эта строка, включая её подготовку и проверки.

  @property [variantPath] - Индексы строк вложенных describe.each от внешнего уровня
  к выбранному примеру. Например, [1, 2] выбирает вторую внешнюю строку и третью
  строку её вложенной таблицы. Остальные строки не выполняют подготовку.
  Не совмещается с variant; test.each не считается уровнем пути.

  @property [signal] - Сигнал отмены запуска; при отмене дочерний процесс завершается.

  @property [onProgress] - Обработчик этапов и фрагментов стандартного и диагностического
  вывода до готовности полного отчёта. `phase` обозначает этап, `text` — фрагмент,
  `stream` — поток `stdout` или `stderr`. Итоговые статусы проверок берутся
  из результата Bun. Исключение обработчика не изменяет выполнение теста.
  */
  export interface Input {
    readonly path: string
    readonly props?: Readonly<Record<string, unknown>>
    readonly testNamePattern?: string
    readonly variant?: number
    /** Индексы строк вложенных describe.each от внешней группы к выбранному примеру.
    Не совмещается с variant; props заменяются в последней выбранной таблице. */
    readonly variantPath?: readonly number[]
    readonly signal?: AbortSignal
    readonly onProgress?: (progress: {
      phase: "queued" | "preparing" | "running" | "reporting"
      text?: string
      stream?: "stdout" | "stderr"
    }) => void
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

  @property validation - Результат проверки правил {@link StorybookSpecsScenariosReaderValidation.Output};
  нереализованные проверки обозначены явно.

  @property [preview] - Представление {@link StorybookAppWebPagePackageScenarioPreview}: компонент с общей тестовой
  заготовкой либо снимки прямых вызовов функции или конструктора default-класса.
  Серверный код не передаётся в браузер для повторного выполнения.
  */
  export interface Output {
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
    readonly validation: StorybookSpecsScenariosReaderValidation.Output
    readonly preview?: StorybookAppWebPagePackageScenarioPreview
  }
}
