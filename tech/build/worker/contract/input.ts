import type {BuildWorkerEvent, BuildWorkerLifecycleEvent} from "./event"
import type {BuildWorkerWorkspace} from "./workspace"

/**
@property entryPath - Исполняемый файл Bun; argv содержит input.json, result.json и workerId.

@property cwd - Рабочая директория дочернего процесса; окружение наследуется штатно.

@property temporaryRoot - Родитель для собственного временного каталога запуска.
Относительный путь разрешается от вызывающего процесса; child получает абсолютные пути файлов.

@property signal - Отмена до запуска предотвращает spawn; после запуска завершает группу.

@property timeoutMs - Положительный конечный бюджет ожидания процесса в миллисекундах.

@property label - Имя операции в транспортных ошибках.

@property createJob - Создаёт JSON-сериализуемый вход после выделения временной области.

@property parseEvent - Проверяет формат владельца, возвращая структурную запись либо null.

@property streamMode - strict отклоняет неверный поток; tolerant игнорирует неверные строки.

@property [onProgress] - Получает phase только после подтверждения ready. Ошибки наблюдателя изолируются.

@property [onLifecycle] - Получает started и exited один раз; ошибки наблюдателя изолируются.

@property [maxResultBytes] - Неотрицательный безопасный целочисленный предел result.json в байтах.
Без поля ограничение размера файла не вводится.
*/
export type BuildWorkerInput<Job, Progress> = Readonly<{
  entryPath: string
  cwd: string
  temporaryRoot: string
  signal: AbortSignal
  timeoutMs: number
  label: string
  createJob(workspace: BuildWorkerWorkspace): Job
  parseEvent(value: unknown): BuildWorkerEvent<Progress> | null
  streamMode: "strict" | "tolerant"
  onProgress?(event: Progress): void
  onLifecycle?(event: BuildWorkerLifecycleEvent): void
  maxResultBytes?: number
}>
