/**
Данные для создания записи о текущем daemon.

@property toolRoot - Реальный корень checkout, которому принадлежит процесс.

@property origin - Канонический loopback HTTP origin уже запущенного сервера.

@property [attachedDeclarations] - Пути подключённых корней; отсутствующий список пуст.
*/
export type ServerRecordInput = Readonly<{
  toolRoot: string
  origin: string
  attachedDeclarations?: readonly string[]
}>

/**
Приватная запись identity и полномочия одного серверного процесса.

@property protocol - Версия проверяемой формы записи.

@property instanceId - Новая identity каждого запуска daemon.

@property controlToken - Приватный bearer token управляющего канала; не публикуется клиентам браузера.

@property toolRoot - Канонический checkout владельца процесса.

@property pid - PID зарегистрированного daemon.

@property processStart - Системная метка старта PID для защиты от его повторного использования.

@property origin - Канонический loopback HTTP origin daemon.

@property healthPath - Маршрут проверки здоровья процесса.

@property websocketPath - Маршрут событий того же сервера.

@property attachedDeclarations - Канонические подключённые корни на момент публикации записи.

@property startedAt - Время создания записи в ISO-формате.
*/
export type ServerRecord = Readonly<{
  protocol: "external-storybook-server/1"
  instanceId: string
  controlToken: string
  toolRoot: string
  pid: number
  processStart: string
  origin: string
  healthPath: "/api/health"
  websocketPath: "/api/events"
  attachedDeclarations: readonly string[]
  startedAt: string
}>

/** Проверенная проекция {@link ServerRecord} без bearer token. */
export type PublicServerRecord = Omit<ServerRecord, "controlToken">

/**
Результат проверки записи и живого процесса.

@property state - `stopped` без записи, `running` после проверки либо `stale` с причиной.

@property record - Проверенная запись, если её удалось прочитать.

@property reason - Диагностика устаревшего состояния либо `null`.

@property replaceable - Разрешено ли заменить запись при следующем запуске.
*/
export type Inspection = Readonly<{
  state: "stopped" | "running" | "stale"
  record: ServerRecord | null
  reason: string | null
  replaceable: boolean
}>

/**
Поколение захваченного startup lease.

@property path - Приватная директория lease.

@property token - Identity поколения, необходимая для записи кандидата.

@property release - Освобождает lease только пока он принадлежит этому поколению;
повторный вызов не меняет состояние.
*/
export type Lease = Readonly<{
  path: string
  token: string
  release(): void
}>

/** Минимальная identity lease для проверки и публикации кандидата. */
export type LeaseIdentity = Readonly<{path: string; token: string}>

/**
Приватный журнал продолжения замены daemon.

@property protocol - Версия формы журнала.

@property toolRoot - Канонический checkout процесса-владельца.

@property declarations - Корни, которые новый daemon должен сохранить подключёнными.

@property [preferredPort] - Прежний порт для попытки повторного использования.

@property recordedAt - Время записи журнала в ISO-формате.
*/
export type MigrationRecord = Readonly<{
  protocol: "external-storybook-migration/1"
  toolRoot: string
  declarations: readonly string[]
  preferredPort?: number
  recordedAt: string
}>

/**
Данные сохранения журнала замены.

@property toolRoot - Checkout, которому принадлежит журнал.

@property declarations - Подключённые корни для нового daemon.

@property [preferredPort] - Необязательный прежний порт.
*/
export type MigrationInput = Readonly<{
  toolRoot: string
  declarations: readonly string[]
  preferredPort?: number
}>

/**
Identity кандидата для атомарной публикации canonical state.

@property lease - Поколение, удерживаемое управляющим процессом.

@property statePath - Канонический путь записи, заменяемой после проверки.

@property toolRoot - Канонический checkout, ожидаемый в кандидате.

@property childPid - PID именно запущенного дочернего daemon.
*/
export type CandidateInput = Readonly<{
  lease: LeaseIdentity
  statePath: string
  toolRoot: string
  childPid: number
}>

/**
Полномочие локального управляющего HTTP-канала.

@property origin - Точный loopback origin серверного процесса.

@property controlToken - Его приватный bearer token.
*/
export type RequestAuthority = Readonly<{origin: string; controlToken: string}>

/** Коды отказа в доступе, различающие Host, Origin, token и browser session. */
export type SecurityErrorCode =
  | "invalid-host"
  | "invalid-origin"
  | "missing-origin"
  | "invalid-control-token"
  | "invalid-browser-session"

/**
Ошибка проверки полномочия с кодом и HTTP-статусом.

@property code - Причина отказа без включения секретного token.

@property status - HTTP-статус для ответа сервера.
*/
export interface SecurityError extends Error {
  readonly code: SecurityErrorCode
  readonly status: 401 | 403 | 421
}
