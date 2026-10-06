import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {Snapshot, Subject} from "./state"
import type {Relocation} from "./relocation"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import type {Environment, EnvironmentInput} from "./environment"
import type {Target} from "./target"
import type {HistoryBody, HistoryPage, HistoryEvidencePage, HistoryQuery, HistoryDisplayPage, HistoryGroupPage, HistoryContentQuery, HistoryContentPage, HistoryDetailPage, HistoryTerminalPage, HistoryTerminalQuery} from "./history"
import type {ExecutionSelection, ExecutionResolution} from "./execution"

type TimelineContent = Extract<StorybookChatHistory.Output[number], {kind: "message"}>["content"][number]

/** Контракт адресных бесед одного Project. */
export declare namespace StorybookChatSession {
  /**
  Хранение и предоставленные приложением возможности исполнения.

  @property directory - Возвращает каталог истории у выбранного владельца, независимый от cache и сборочных ревизий.
  @property [legacyDirectory] - Прежний общий каталог для переноса существующих историй без изменения сообщений и identity.
  @property resolve - Разрешает точный адрес по действующему каталогу и возвращает его владельца.
  Его cwd используется только во время работы; сохранённая сессия хранит `.` относительно владельца.
  @property connect - Создаёт ACP-подключение с контекстом указанного предмета при первом сообщении или явной подготовке настроек.
  @property [environment] - Назначает окружение до подключения модели. Сессия доставляет
  начальный контекст и исполняет полные сообщения-команды до итогового ответа без MCP.
  */
  type Input = Readonly<{
    directory(subject: Pick<Subject, "address" | "cwd">): string
    legacyDirectory?: string
    /** Максимум неактивных resident states, по умолчанию 32. */
    maxInactiveSessions?: number
    /** Пауза до закрытия неактивного ACP и окружения, по умолчанию 30000 мс. */
    idleConnectionMs?: number
    /** Максимум подключённых ACP, по умолчанию 4. */
    maxConnections?: number
    /** Максимум ещё не начатых задач одной беседы, по умолчанию 128. */
    maxPending?: number
    resolve(address: string): Subject
    /** Разрешает переносимые настройки без подключения модели; тип предмета подтверждает хост. */
    resolveExecution?(input: Readonly<{subject: Subject, executorId: string, sessionId?: string, selection: ExecutionSelection, executorSelection?: ExecutionSelection, pinnedConnectionId?: string}>): Promise<ExecutionResolution>
    /** Сохраняет выбор агента у предмета независимо от удаления его бесед. */
    saveExecutorSelection?(input: Readonly<{subject: Subject, executorId: string, selection: ExecutionSelection}>): Promise<void>
    /** Только управляющее действие человека; чтение editable истории не авторизует режим. */
    saveSessionApproval?(input: Readonly<{sessionId: string, approvalMode?: ExecutionSelection["approvalMode"]}>): Promise<void>
    environment?(input: EnvironmentInput): Promise<Environment>
    connect(input: Readonly<{
      subject: Subject
      /** Локальная identity выбранной беседы, независимо от provider sessionId. */
      localSessionId: string
      /** UUID сохраняемого исполнителя, независимый от адреса и provider session. */
      executorId: string
      /** Имя исполнителя внутри предмета, независимое от имени самого предмета. */
      executorLabel: string
      execution: ExecutionResolution
      previousSessionId?: string
      preferResume?: boolean
      signal: AbortSignal
      onProgress?: StorybookTechAcp.Input["onProgress"]
      onUpdate: StorybookTechAcp.Input["onUpdate"]
      onReplay?: StorybookTechAcp.Input["onReplay"]
      onPermission: StorybookTechAcp.Input["onPermission"]
    }>): Promise<StorybookTechAcp.Output>
  }>

  /**
  История, поток состояния и действия над беседой.

  @property read - Возвращает свежий компактный snapshot, не создавая пустой файл.
  Он включает счётчики ещё не опубликованных потоковых записей и их version. Сохранённые pending
  при загрузке восстанавливают ранее принятую работу; обычное чтение без них не запускает модель.

  @property prompt - Сохраняет текст либо штатные ACP ContentBlock и начинает один turn;
  requestId предотвращает повторную отправку. Текст ограничен 64000 символами,
  уже сохранённая история не обрезается.

  @property cancel - Запрашивает отмену только текущего turn выбранной беседы.

  @property permission - Разрешает ожидающий запрос ровно одним из переданных исполнителем вариантов.

  @property subscribe - Немедленно передаёт текущий снимок. Потоковые ACP/replay/environment
  updates объединяются до создания компактного snapshot примерно за 50 мс; raw evidence
  сохраняется на диске, version отражает каждую мутацию. Управляющие переходы и финальный результат
  публикуются без этого ожидания и снимают pending publication. Последняя отписка
  очищает timer, не отменяя выполнение; без наблюдателей поток не создаёт snapshots.

  @property relocate - Переносит только явно названную историю на новый адрес,
  сохраняя id, сообщения и ACP sessionId. При активном turn или занятой цели
  отказывает без перезаписи. Старый файл остаётся для восстановления.

  @property dispose - Отменяет работу, закрывает подключения и дожидается записи историй.

  @property migrateLegacy - Копирует известные истории из прежнего общего каталога к владельцам без запуска агентов.
  Истории неразрешённых адресов сохраняются на прежнем месте; существующие назначения не перезаписываются.
  */
  type Output = Readonly<{
    /** Явно создаёт независимого именованного исполнителя и сохраняет его пустую историю. */
    create(input: Readonly<{address: string, label: string}>): Promise<Snapshot>
    /** Перечисляет только беседы выбранного адреса, включая уже загруженный empty default; по одному designated snapshot агента. */
    list(address: string): Promise<readonly Snapshot[]>
    /** Создаёт пустую именованную сессию существующего агента без подключения ACP. */
    createSession(target: Target, label?: string): Promise<Snapshot>
    /** Перечисляет сохранённые сессии выбранного агента без запуска модели. */
    listSessions(target: Target): Promise<readonly Snapshot[]>
    /** Корзина выбранного агента; purged записи не раскрываются как восстановимые. */
    listDeletedSessions(target: Target): Promise<readonly (Snapshot & Readonly<{deletedAt?: string, recoverable: boolean}>)[]>
    /** Восстанавливает исходную identity и историю точной удалённой беседы без prompt. */
    restoreSession(target: Target): Promise<Snapshot>
    /** Отдельное необратимое действие над точной беседой, уже находящейся в корзине. */
    purgeSession(target: Target): Promise<void>
    /** Меняет только имя точной выбранной локальной сессии. */
    renameSession(target: Target, label: string): Promise<Snapshot>
    /** Перемещает неактивную локальную сессию в корзину без потери source; provider remote не затрагивается. */
    deleteSession(target: Target): Promise<void>
    migrateLegacy(): Promise<Readonly<{migrated: number, unresolved: readonly string[]}>>
    read(target: Target): Promise<Snapshot>
    /** Читает ограниченную страницу заголовков без подключения исполнителя. */
    history(target: Target, query?: HistoryQuery): Promise<HistoryPage>
    /** Ограниченная страница сообщений и целых свёрнутых служебных групп. */
    displayHistory(target: Target, query?: HistoryQuery): Promise<HistoryDisplayPage>
    /** Ленивое чтение occurrences одной группы; payload не входит в заголовки. */
    groupHistory(target: Target, groupId: string, query?: HistoryQuery): Promise<HistoryGroupPage>
    /** Точное содержимое occurrence, а не позднейшая версия агрегата инструмента. */
    groupHistoryItem(target: Target, groupId: string, id: string): Promise<HistoryBody>
    /** Читает тело одной записи, без raw updates. */
    historyItem(target: Target, id: string): Promise<HistoryBody>
    /** Продолжение большого текста без полной загрузки записи. */
    historyContent(target: Target, id: string, query?: HistoryContentQuery): Promise<HistoryContentPage>
    historyTerminal(target: Target, id: string, query?: HistoryTerminalQuery): Promise<HistoryTerminalPage>
    historyDetail(target: Target, id: string, query?: {offset?: number; maxBytes?: number; evidenceId?: string}): Promise<HistoryDetailPage>
    /** Читает ограниченную страницу исходных свидетельств записи. */
    historyEvidence(target: Target, id: string, query?: HistoryQuery): Promise<HistoryEvidencePage>
    hasMedia(target: Target, digest: string): Promise<boolean>
    copyMessage(target: Target, id: string): Promise<string>
    /** Получает настройки без собственного prompt; после подготовки может продолжить ранее сохранённые pending. */
    prepare(target: Target): Promise<Snapshot>
    /** Меняет выбранную настройку вне turn; применённые значения подтверждает агент. */
    configure(target: Target, id: string, value: string): Promise<Snapshot>
    /** Заменяет явный выбор беседы либо агента; пустой объект возвращает наследование. */
    configureExecution(target: Target, input: Readonly<{scope: "executor" | "session", selection: ExecutionSelection}>): Promise<Snapshot>
    prompt(target: Target, content: string | readonly TimelineContent[], requestId: string): Promise<Snapshot>
    /** Сохраняет идемпотентную входящую задачу и запускает её после текущей работы. */
    enqueue(target: Target, content: string | readonly TimelineContent[], requestId: string): Promise<Snapshot>
    cancel(target: Target): Promise<Snapshot>
    permission(target: Target, id: string, optionId: string, requestHash?: string): Promise<Snapshot>
    /** Завершает принадлежащее чату подключение, когда обычная отмена не подтверждена. */
    stop(target: Target): Promise<Snapshot>
    subscribe(target: Target, listener: (value: Snapshot) => void): Promise<() => void>
    relocate(input: Relocation): Promise<Snapshot | null>
    dispose(): Promise<void>
  }>
}
