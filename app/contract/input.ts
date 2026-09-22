import type {ReadScenarioInput, ScenarioPreview} from "@archetypes/specs/scenarios"
import type {CompiledTemplate} from "@zavx0z/template/compiled"

/**
Данные для выбора и просмотра вариантов сценария компонента или функции.

@property kind - Вид представления: `component` для просмотра компонента,
`function` для просмотра исходов вызовов функции.

@property template - Скомпилированный шаблон компонента. Присутствует только
в ветви `component` и обязателен для неё.

@property variants - Варианты из {@link ScenarioPreview} в порядке показа.
Список непустой, идентификаторы вариантов уникальны; первым выбирается первый элемент.

@property [run] - Выполнение теста выбранного варианта принимающей стороной.
Получает исходный вариант, сигнал отмены и обработчик хода выполнения.
Возвращает исходник, проверенные свойства компонента при наличии, вызовы,
пункты и итог тестов. При смене выбора предыдущий запрос отменяется.
Без обработчика приложение использует подготовленные данные без нового запуска.
*/
export type ScenarioAppInput = (
  | {
    readonly kind: "component"
    readonly template: CompiledTemplate<Record<string, unknown>>
    readonly variants: Extract<ScenarioPreview, {kind: "component"}>["variants"]
  }
  | {
    readonly kind: "function"
    readonly variants: Extract<ScenarioPreview, {kind: "function"}>["variants"]
  }
) & {
    readonly run?: (
      variant: ScenarioPreview["variants"][number],
      signal: AbortSignal,
      onProgress: NonNullable<ReadScenarioInput["onProgress"]>,
    ) => Promise<{
      source: string
      props?: Readonly<Record<string, unknown>>
      calls: Extract<ScenarioPreview, {kind: "function"}>["variants"][number]["calls"]
      points: Extract<ScenarioPreview, {kind: "function"}>["variants"][number]["points"]
      execution: {
        status: "passed" | "failed"
        message?: string
        tests: readonly {label: string, status: string, message: string | null}[]
      }
    }>
  }
