import type {ReadScenarioInput, ScenarioPreview} from "@storybook/app-old/scenarios"
import type {CompiledTemplate} from "@zavx0z/template/compiled"

/**
Данные для выбора и просмотра вариантов сценария компонента или функции.

@property kind - Вид представления: `component` для просмотра компонента,
`function` для просмотра исходов вызовов функции.

@property template - Скомпилированный шаблон компонента. Присутствует только
в ветви `component` и обязателен для неё.

@property variants - Варианты из {@link ScenarioPreview} в порядке показа.
Список непустой, идентификаторы вариантов уникальны; первым выбирается первый элемент.

@property [run] - Получение результата проверки выбранного варианта принимающей стороной.
Получает исходный вариант, сигнал отмены и обработчик хода выполнения.
Возвращает исходник, проверенные свойства компонента при наличии, вызовы,
пункты и итог тестов. Последний аргумент rerun требует нового выполнения.
При смене выбора предыдущий читатель отсоединяется от запроса.
Без обработчика приложение использует подготовленные данные без нового запуска.
*/
export type ScenarioAppInput = (
  | {
    readonly kind: "component"
    readonly template: CompiledTemplate<Record<string, unknown>>
    /** Дополняет проверенные JSON-props JSX-значениями из модулей той же ревизии. */
    readonly resolveProps?: (variantId: string, props: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>
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
      rerun?: boolean,
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
