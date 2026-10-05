import type {MediaDraftAttachment} from "@zavx0z/chat/media"
import type {MediaPreview} from "@zavx0z/chat/content"
import type {HistoryWindow, HistoryViewport} from "./history"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>

/** Представление беседы с управляемыми принимающим владельцем данными. */
export declare namespace StorybookChatView {
  /**
  Снимок одной беседы и действия над ней.

  @property address - Канонический адрес предмета беседы; не содержит выбора представления или секции.

  @property label - Название предмета для доступного имени беседы.

  @property history - Ограниченное окно заголовков и запрошенных тел. Полная история
  остаётся у Session/archive. Свёрнутые служебные записи, offscreen тела и evidence
  не удерживаются представлением. Новые записи при чтении прошлого меняют unread,
  сохраняя ordinal anchor. Lazy callbacks не запускают и не отменяют серверный turn.

  @property draft - Управляемый текст редактора. Владелец сохраняет его отдельно для каждого адреса.

  @property status - При connecting и running отправка недоступна, а отмена доступна.

  @property [sending=false] - Локальная отправка HTTP-запроса блокирует повторную отправку.
  Она не означает, что сервер уже принял turn; возможность отмены определяется status.

  @property onDraftChange - Передаёт полный новый текст принимающему владельцу черновика, включая переносы строк.

  @property onSend - Передаёт намерение отправить текущий непустой черновик. Принимающий владелец подтверждает результат через новый снимок.

  @property onCancel - Запрашивает отмену подтверждённого сервером подключения или выполнения. Закрытие представления не вызывает этот callback.

  @property [settings] - Полученные от агента модели и уровни мышления; клиент не добавляет собственные варианты.

  @property [configuring=false] - Настройки загружаются или применяются; отправка и изменение выбора временно недоступны.

  @property [usage] - Последние фактические used/size контекстного окна. Отсутствие данных не означает нулевое заполнение.

  @property [onPrepareSettings] - Запрашивает варианты при первом открытии выбора; не отправляет сообщение агенту.

  @property [onConfigure] - Передаёт точные id и value выбранного варианта. Новые значения возвращаются в settings после подтверждения агентом.

  @property [permissions] - Ожидающие решения пользователя запросы; варианты предоставляет исполнитель.

  @property [onPermission] - Передаёт выбранный вариант владельцу запроса. Без callback варианты недоступны.

  @property [executorId] - UUID выбранного исполнителя в беседе текущего address.
  */
  type Input = Readonly<Pick<Snapshot, "address" | "label" | "status"> & {
    history: HistoryWindow
    onHistoryViewport(value: HistoryViewport): void
    onHistoryVisible(value: boolean): void
    onHistoryExpand(id: string, value: boolean): void
    onHistoryRetry(id: string): void
    onHistoryEvidence(id: string, after?: number): void
    onHistoryTail(): void
    draft: string
    attachments?: readonly MediaDraftAttachment[] | undefined
    attaching?: boolean | undefined
    media?: MediaPreview | null | undefined
    onAttach?: (() => void) | undefined
    onRemoveAttachment?: ((id: string) => void) | undefined
    onMedia?: ((value: MediaPreview | null) => void) | undefined
    sending?: boolean | undefined
    error?: string | undefined
    onDraftChange(value: string): void
    onSend(): void
    onCancel(): void
    settings?: Snapshot["settings"]
    configuring?: boolean | undefined
    /** Наблюдаемый этап подключения, предоставленный сессией. */
    progress?: string | undefined
    usage?: Snapshot["usage"]
    onPrepareSettings?: (() => void) | undefined
    onConfigure?: ((id: string, value: string) => void) | undefined
    permissions?: Snapshot["permissions"] | undefined
    onPermission?: ((id: string, optionId: string) => void) | undefined
    executorId?: string | undefined
    pendingTasks?: number | undefined
  }>
}
