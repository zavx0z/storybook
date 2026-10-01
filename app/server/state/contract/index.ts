import type {HttpClient} from "@http/client"
import type {
  CandidateInput,
  Inspection,
  Lease,
  LeaseIdentity,
  MigrationInput,
  MigrationRecord,
  PublicServerRecord,
  RequestAuthority,
  SecurityError,
  SecurityErrorCode,
  ServerRecord,
  ServerRecordInput,
} from "./state"

/** Контракт состояния и авторизации единственного серверного процесса Storybook. */
export declare namespace AppServerState {
  /**
  @property client - Создаёт HTTP-клиент записи. Полномочие проверяется при каждом запросе; клиент не управляет временем жизни сервера.

  Согласованный набор операций над приватной записью процесса, startup lease
  и полномочиями локального HTTP-канала. Чтение состояния не запускает сервер.

  @property EXTERNAL_STORYBOOK_SERVER_PROTOCOL - Версия формата записи,
  проверяемая при чтении и публикации.

  @property ExternalStorybookSecurityError - Общий конструктор ошибок проверки
  Host, Origin, bearer и browser session; `code` и HTTP `status` позволяют
  серверу отличить отказ в доступе от прочих ошибок без сравнения сообщений.

  @property externalStorybookStateRoot - Возвращает канонический cache root
  пользователя либо `STORYBOOK_STATE_ROOT`, не создавая директорию.

  @property externalStorybookServerStatePath - Возвращает путь `server.json`
  внутри текущего root без чтения записи.

  @property externalStorybookArtifactRoot - Возвращает путь артефактов рядом
  с серверной записью без их подготовки.

  @property externalStorybookMigrationStatePath - Возвращает путь журнала
  замены daemon без чтения файла.

  @property readExternalStorybookMigrationRecord - Читает указанный или
  канонический журнал замены; отсутствующий файл даёт `null`, повреждённая
  запись вызывает ошибку проверки.

  @property writeExternalStorybookMigrationRecord - Проверяет `toolRoot`,
  декларации и необязательный порт, атомарно записывает приватный журнал
  по указанному или каноническому пути и возвращает сохранённую запись.

  @property clearExternalStorybookMigrationRecord - Удаляет журнал по
  указанному или каноническому пути только для точного `toolRoot`;
  возвращает `false` при отсутствии и вызывает ошибку для чужого владельца.

  @property externalStorybookLegacyStatePaths - Возвращает известные старые
  пути состояния для миграции; при заданном `STORYBOOK_STATE_ROOT` список пуст.

  @property acquireExternalStorybookStartLease - Атомарно захватывает lease
  для указанного или канонического server state path; возвращённый `release`
  освобождает только своё поколение. Живой конкурент вызывает ошибку.

  @property assertExternalStorybookStartLease - Проверяет точные путь и token
  lease перед публикацией; замещённое поколение вызывает ошибку.

  @property writeExternalStorybookStartCandidate - Проверяет lease и запись
  с digest, затем атомарно сохраняет кандидата; ошибка записи или смена lease
  не публикует канонический server state.

  @property publishExternalStorybookStartCandidate - Публикует кандидата только
  при совпадении lease, `toolRoot` и PID ребёнка; возвращает запись либо `null`,
  если кандидат ещё не появился. Несовпадение identity вызывает ошибку.

  @property createExternalStorybookServerRecord - Создаёт приватную запись
  текущего процесса из canonical `toolRoot`, loopback HTTP origin и digest;
  возвращает новый instance ID и bearer token. Неверные входы вызывают ошибку.

  @property writeExternalStorybookServerRecord - Атомарно записывает точную
  validated запись в приватный файл с mode 0600; относительный путь и запись
  без digest вызывают ошибку.

  @property projectExternalStorybookServerRecord - Проверяет запись и удаляет
  bearer token из публичной проекции, не меняя приватную запись.

  @property readExternalStorybookServerRecord - Читает и проверяет запись по
  переданному пути; ошибка чтения или несовпадение формата не принимается
  за остановленный сервер.

  @property inspectExternalStorybookServer - Проверяет запись, PID, cwd и
  `/api/health` по указанному или каноническому пути; возвращает `stopped`,
  `running` либо диагностическое `stale`, не запускает и не останавливает daemon.

  @property removeReplaceableExternalStorybookState - Удаляет state-файл
  только для `stale` с `replaceable: true`; другие состояния вызывают ошибку.

  @property readProcessStart - Читает системную метку старта точного PID;
  возвращает `null`, когда процесс или сведения о нём недоступны.

  @property readProcessDirectory - Читает canonical cwd точного PID;
  возвращает `null`, когда путь или процесс недоступен.

  @property processExists - Проверяет наличие точного PID без остановки процесса.

  @property externalStorybookControlAuthorization - Валидирует token и
  возвращает private `Bearer` header; неверная форма token вызывает ошибку.

  @property externalStorybookControlTokenMatches - Сравнивает переданный
  Authorization с token по digest без data-dependent сравнения строк.

  @property assertExternalStorybookRequestHost - Проверяет URL и Host запроса
  относительно ожидаемого loopback origin; несоответствие вызывает
  `ExternalStorybookSecurityError` с HTTP 421.

  @property assertExternalStorybookRequestOrigin - Проверяет browser Origin
  относительно ожидаемого loopback origin; `required: true` запрещает
  отсутствие заголовка, неверный Origin вызывает HTTP 403.

  @property assertExternalStorybookControlRequest - Проверяет Host,
  необязательный Origin и bearer у запроса к управляющему каналу; ошибка
  полномочия вызывает HTTP 401, Host и Origin сохраняют свои статусы.
  */
  type Output = Readonly<{
    client(record: ServerRecord): HttpClient.Output
    EXTERNAL_STORYBOOK_SERVER_PROTOCOL: "external-storybook-server/1"
    ExternalStorybookSecurityError: new (
      code: SecurityErrorCode,
      status: 401 | 403 | 421,
      message: string,
    ) => SecurityError
    externalStorybookStateRoot(): string
    externalStorybookServerStatePath(): string
    externalStorybookArtifactRoot(): string
    externalStorybookMigrationStatePath(): string
    readExternalStorybookMigrationRecord(path?: string): MigrationRecord | null
    writeExternalStorybookMigrationRecord(input: MigrationInput, path?: string): MigrationRecord
    clearExternalStorybookMigrationRecord(toolRoot: string, path?: string): boolean
    externalStorybookLegacyStatePaths(): readonly string[]
    acquireExternalStorybookStartLease(statePath?: string): Lease
    assertExternalStorybookStartLease(path: string, token: string): void
    writeExternalStorybookStartCandidate(lease: LeaseIdentity, record: ServerRecord): void
    publishExternalStorybookStartCandidate(input: CandidateInput): ServerRecord | null
    createExternalStorybookServerRecord(input: ServerRecordInput): ServerRecord
    writeExternalStorybookServerRecord(path: string, record: ServerRecord): void
    projectExternalStorybookServerRecord(value: ServerRecord): PublicServerRecord
    readExternalStorybookServerRecord(path: string): ServerRecord
    inspectExternalStorybookServer(statePath?: string): Promise<Inspection>
    removeReplaceableExternalStorybookState(value: Inspection, statePath?: string): void
    readProcessStart(pid: number): string | null
    readProcessDirectory(pid: number): string | null
    processExists(pid: number): boolean
    externalStorybookControlAuthorization(controlToken: string): string
    externalStorybookControlTokenMatches(authorization: string | null, controlToken: string): boolean
    assertExternalStorybookRequestHost(request: Request, expectedOrigin: string): void
    assertExternalStorybookRequestOrigin(request: Request, expectedOrigin: string, options?: Readonly<{required?: boolean}>): void
    assertExternalStorybookControlRequest(request: Request, authority: RequestAuthority): void
  }>
}
