import type {ScenarioAppInput} from "./input"
import type {ReadScenarioInput} from "@archetypes/specs/scenarios"

/**
Согласованное состояние редактора и области просмотра выбранного сценария.

Снимок отражает выбор, а при подключённом выполнении теста — также ход и итог
этого запуска. Принимающая сторона показывает компонент после успешного
теста с проверенными свойствами и владеет его монтированием.

@property kind - Вид представления из {@link ScenarioAppInput}.

@property variants - Исходный упорядоченный список доступных вариантов.
*/
export interface ScenarioApp {
  readonly kind: ScenarioAppInput["kind"]
  readonly variants: ScenarioAppInput["variants"]
  /**
  Возвращает текущий вариант и доступные сведения о его выполнении.

  В `execution.status` различаются выполнение, успешное завершение и ошибка.
  `progress` содержит текущий этап и накопленный вывод; `tests` — итоги тестов.
  Без подключённого запуска сведения `execution` могут отсутствовать.
  */
  getSnapshot(): ScenarioAppInput["variants"][number] & {
    readonly execution?: {
      readonly status: "running" | "passed" | "failed"
      readonly message?: string
      readonly progress?: {
        readonly phase: Parameters<NonNullable<ReadScenarioInput["onProgress"]>>[0]["phase"]
        readonly output: string
      }
      readonly tests?: readonly {label: string, status: string, message: string | null}[]
    }
  }
  /**
  Подписывает наблюдателя на изменение выбора, хода или итога запуска.

  @param listener - Обработчик уведомления; актуальные данные читаются из снимка.

  @returns Функция удаления этой подписки.
  */
  subscribe(listener: () => void): () => void
  /**
  Выбирает вариант по идентификатору и запускает его тест, если запуск подключён.

  Повторный выбор текущего идентификатора ничего не меняет.
  После освобождения приложения выбор игнорируется.

  @param id - Идентификатор одного из элементов `variants`.

  @throws Ошибка, если у действующего приложения нет указанного варианта.
  */
  select(id: string): void
  /**
  Отменяет текущий запрос, очищает подписки и прекращает обработку выбора.
  Поздние результаты отменённого запроса не меняют снимок.
  */
  dispose(): void
}
