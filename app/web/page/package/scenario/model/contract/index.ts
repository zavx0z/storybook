import type {StorybookSpecsScenariosReader} from "@storybook-specs-scenarios/reader"
import type {CompiledTemplate} from "@immersive/template/compiled"

/** Подготовленные данные выбранного сценария принадлежат читателю Specs. */
type Preview = NonNullable<StorybookSpecsScenariosReader.Output["preview"]>

/** Контракт модели выбора и повторного выполнения вариантов сценария. */
export declare namespace StorybookAppWebPagePackageScenarioModel {
  /**
  Данные подготовленного сценария и операция его повторного выполнения.

  @property kind - Компонент либо сохранённые исходы вызовов функции.
  @property template - Compiled template общей фикстуры, обязательный только для component.
  @property [resolveProps] - Дополняет JSON-props JSX-значениями модулей той же ревизии.
  @property variants - Непустой список вариантов с уникальными идентификаторами; первым выбирается первый.
  @property [run] - Получает вариант, сигнал отмены, обработчик прогресса и флаг явного повтора.
  Возвращает результат проверки. Смена выбора отменяет прежнее ожидание; поздний ответ не меняет снимок.
  Без этой операции используется подготовленный отчёт.
  */
  type Input = (
    | {
      readonly kind: "component"
      readonly template: CompiledTemplate<Record<string, unknown>>
      readonly resolveProps?: (variantId: string, props: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>
      readonly variants: Extract<Preview, {kind: "component"}>["variants"]
    }
    | {readonly kind: "function"; readonly variants: Extract<Preview, {kind: "function"}>["variants"]}
  ) & {
    readonly run?: (
      variant: Preview["variants"][number],
      signal: AbortSignal,
      onProgress: NonNullable<StorybookSpecsScenariosReader.Input["onProgress"]>,
      rerun?: boolean,
    ) => Promise<{
      source: string
      props?: Readonly<Record<string, unknown>>
      calls: Extract<Preview, {kind: "function"}>["variants"][number]["calls"]
      points: Extract<Preview, {kind: "function"}>["variants"][number]["points"]
      execution: {
        status: "passed" | "failed"
        message?: string
        tests: readonly {label: string; status: string; message: string | null}[]
      }
    }>
  }

  /**
  Модель выбранного варианта; монтирование и отображение принадлежат принимающей стороне.

  @property kind - Вид представления из Input.
  @property variants - Исходный упорядоченный список вариантов.
  @property getSnapshot - Возвращает текущий вариант, прогресс и итог выполнения; не запускает проверку.
  @property subscribe - Подключает уведомление об изменении снимка; возвращает отписку.
  @property select - Выбирает известный id. Повтор текущего выбора ничего не меняет, неизвестный id вызывает ошибку.
  После dispose выбор игнорируется; сохранённый итог повторно не выполняется.
  @property run - Повторяет тест выбранного варианта; повтор во время исполнения игнорируется.
  @property dispose - Отменяет ожидание, очищает подписки и прекращает обработку выбора и поздних ответов.
  */
  interface Output {
    readonly kind: Input["kind"]
    readonly variants: Input["variants"]
    getSnapshot(): Input["variants"][number] & {
      readonly execution?: {
        readonly status: "running" | "passed" | "failed"
        readonly message?: string
        readonly progress?: {
          readonly phase: Parameters<NonNullable<StorybookSpecsScenariosReader.Input["onProgress"]>>[0]["phase"]
          readonly output: string
        }
        readonly tests?: readonly {label: string; status: string; message: string | null}[]
      }
    }
    subscribe(listener: () => void): () => void
    select(id: string): void
    run(): void
    dispose(): void
  }
}
