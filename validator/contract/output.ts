/**
Структурированный результат запуска существующих тестов.

@property status - passed/failed отражают проверки; error — ошибку запуска или отчёта;
empty означает отсутствие выполненных проверок после фильтрации.
@property path - Абсолютный путь проверяемого объекта.
@property specification - Абсолютный путь выбранного файла или директории тестов.
@property summary - Счётчики из разобранных тестовых случаев JUnit.
Skipped включает отфильтрованные тесты: JUnit Bun не разделяет эти случаи.
@property tests - Проверки с их группой, исходником, статусом и сообщениями.
@property process - Полный stdout, stderr и исходный JUnit, а также код завершения и сигнал.
@property error - Ошибка запуска или чтения отчёта; null при обычном завершении тестов.
*/
export interface ValidationOutput {
  readonly status: "passed" | "failed" | "error" | "empty"
  readonly path: string
  readonly specification: string
  readonly summary: {
    readonly total: number
    readonly passed: number
    readonly failed: number
    readonly skipped: number
    readonly errors: number
  }
  readonly tests: readonly {
    readonly name: string
    readonly group: string
    readonly file: string
    readonly line: number | null
    readonly status: "passed" | "failed" | "skipped" | "error"
    readonly message: string | null
    readonly details: string | null
  }[]
  readonly process: {
    readonly exitCode: number | null
    readonly signal: string | null
    readonly stdout: string
    readonly stderr: string
    readonly junit: string | null
  }
  readonly error: string | null
}
