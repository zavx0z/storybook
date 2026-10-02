import type {CodeEditorProps} from "@zavx0z/ui/view/code-editor"
import type {ChatSession} from "@chat/session"

type Snapshot = Awaited<ReturnType<ChatSession.Output["read"]>>

/** Представление беседы с управляемыми принимающим владельцем данными. */
export declare namespace ChatView {
  /**
  Снимок одной беседы и действия над ней.

  @property address - Канонический адрес предмета беседы; не содержит выбора представления или секции.

  @property label - Название предмета для шапки и доступного имени беседы.

  @property messages - Порядок сообщений задаёт владелец сессии; текст показывается без исполнения разметки.

  @property draft - Управляемый текст редактора. Владелец сохраняет его отдельно для каждого адреса.

  @property status - При connecting и running отправка недоступна, а отмена доступна.

  @property [sending=false] - Локальная отправка HTTP-запроса блокирует повторную отправку.
  Она не означает, что сервер уже принял turn; возможность отмены определяется status.

  @property onDraftChange - Передаёт полный новый текст принимающему владельцу черновика, включая переносы строк.

  @property onSend - Передаёт намерение отправить текущий непустой черновик. Принимающий владелец подтверждает результат через новый снимок.

  @property onCancel - Запрашивает отмену подтверждённого сервером подключения или выполнения. Закрытие представления не вызывает этот callback.

  @property [permissions] - Ожидающие решения пользователя запросы; варианты предоставляет исполнитель.

  @property [onPermission] - Передаёт выбранный вариант владельцу запроса. Без callback варианты недоступны.
  */
  type Input = Readonly<Pick<Snapshot, "address" | "label" | "messages" | "status"> & {
    draft: string
    sending?: boolean
    error?: string
    onDraftChange: NonNullable<CodeEditorProps["onChange"]>
    onSend(): void
    onCancel(): void
    permissions?: Snapshot["permissions"]
    onPermission?(id: string, optionId: string): void
  }>
}
