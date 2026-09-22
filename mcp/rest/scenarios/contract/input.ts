import type {ReadSpecOutput} from "@archetypes/specs"

/**
Выбор сценария и формы его представления в HTTP-ответе.

@property path - Директория владельца, чья публичная спецификация читается.

@property [source] - Ожидаемый исходный файл для проверки принадлежности сценария.
Несовпадение с файлом, возвращённым спецификацией, считается ошибкой.

@property [prepared] - Уже выполненная спецификация применённой ревизии.
`revision` обозначает ревизию, `result` содержит {@link ReadSpecOutput}.
При наличии этих данных сценарий не запускается повторно.

@property [format=document] - `document` возвращает предметную документацию,
`data` — полный диагностический каталог без выбора отдельной темы.

@property [selection] - Выбор варианта по названию `variant` и вложенной темы
по пути `section`. Применяется только в режиме `document`;
совместное использование с `data` отклоняется.
*/
export interface ReadScenariosInput {
  readonly path: string
  readonly source?: string
  readonly prepared?: {
    readonly revision: string
    readonly result: ReadSpecOutput
  }
  readonly format?: "document" | "data"
  readonly selection?: {
    readonly variant?: string
    readonly section?: readonly string[]
  }
}
