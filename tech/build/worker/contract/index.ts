import type {BuildWorkerEvent, BuildWorkerLifecycleEvent} from "./event"
import type {BuildWorkerWorkspace} from "./workspace"

/** Исполнение одной JSON-задачи в точном дочернем процессе. */
export declare namespace Zavx0zStorybookTechBuildWorker {
  /**
  Работа и проверка событий задаются владельцем задачи.

  @typeParam Job - JSON-сериализуемое задание конкретного владельца.
  @typeParam Progress - Проверенное сообщение хода этого задания.
  @property entryPath - Исполняемый файл Bun; argv получает пути и workerId.
  @property cwd - Рабочая директория дочернего процесса.
  @property temporaryRoot - Родитель временной области, выделяемой одним запуском.
  @property signal - Отмена до и после spawn точного процесса.
  @property [timeoutMs] - Явный бюджет вызывающего кода; без него ожидание результата или отмены.
  @property label - Имя операции в транспортных ошибках.
  @property createJob - Создаёт задание после выделения временной области.
  @property parseEvent - Проверяет формат события владельца или возвращает null.
  @property streamMode - strict отклоняет неверный поток; tolerant игнорирует строки.
  @property [onProgress] - Получает phase после ready; ошибки callback изолируются.
  @property [onLifecycle] - Получает started и exited один раз; ошибки изолируются.
  @property [maxResultBytes] - Неотрицательный предел result.json в байтах.
  @property [hardKillDelayMs] - Конечная неотрицательная задержка SIGKILL после SIGTERM, в миллисекундах.
  Без значения сохраняется задержка 1000 мс; владелец может дать worker время на асинхронное освобождение.
  */
  type Input<Job, Progress> = Readonly<{
    entryPath: string
    cwd: string
    temporaryRoot: string
    signal: AbortSignal
    timeoutMs?: number | undefined
    label: string
    createJob(workspace: BuildWorkerWorkspace): Job
    parseEvent(value: unknown): BuildWorkerEvent<Progress> | null
    streamMode: "strict" | "tolerant"
    onProgress?(event: Progress): void
    onLifecycle?(event: BuildWorkerLifecycleEvent): void
    maxResultBytes?: number
    hardKillDelayMs?: number
  }>

  /**
  Подтверждённое завершение и непрозрачный JSON-результат.

  @property workerId - Идентификатор завершённого запуска.
  @property ready - Подтверждение точных nonce и PID.
  @property exitCode - Код завершения, интерпретируемый владельцем задачи.
  @property stderr - Ограниченный диагностический поток.
  @property result - JSON результата; undefined при отсутствии файла.
  */
  type Output = Readonly<{
    workerId: string
    ready: boolean
    exitCode: number
    stderr: string
    result: unknown
  }>
}
