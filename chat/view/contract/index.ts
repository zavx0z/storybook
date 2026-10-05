import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>

/** Представление беседы с управляемыми принимающим владельцем данными. */
export declare namespace StorybookChatView {
  /**
  Снимок одной беседы и действия над ней.

  @property address - Канонический адрес предмета беседы; не содержит выбора представления или секции.

  @property label - Название предмета для доступного имени беседы.

  @property messages - Порядок сообщений задаёт владелец сессии. Ответы и fenced-код показываются через Markdown с подсветкой; код не исполняется.

  @property [timeline] - Сохраняемая история владельца сессии. При наличии заменяет messages;
  вызовы инструментов, контекст, мысли и служебные события изначально свёрнуты.
  Детали создаются после раскрытия, которое сохраняется по стабильному id записи.
  Текст и изображения показываются в общем Document. Аудио и бинарные ресурсы
  обозначаются явно; собственного проигрывателя и загрузки ресурсов у представления нет.

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
  @property [executors] - Исполнители этого адреса, их имена, состояния и ожидающие задачи.
  Выбор участника отделён от настройки его модели и не запускает prompt.
  @property [pendingTasks=0] - Число ожидающих задач выбранного исполнителя.
  @property [managingExecutors=false] - Список загружается либо создаётся специалист.
  @property [onSelectExecutor] - Передаёт UUID участника владельцу текущего адреса.
  @property [onCreateExecutor] - Создаёт именованного специалиста без постановки задачи.
  Promise подтверждает создание; отказ сохраняет введённое имя и показывается в форме.
  */
  type Input = Readonly<Pick<Snapshot, "address" | "label" | "messages" | "status"> & {
    timeline?: Snapshot["timeline"] | undefined
    draft: string
    sending?: boolean
    error?: string
    onDraftChange(value: string): void
    onSend(): void
    onCancel(): void
    settings?: Snapshot["settings"]
    configuring?: boolean
    /** Наблюдаемый этап подключения, предоставленный сессией. */
    progress?: string | undefined
    usage?: Snapshot["usage"]
    onPrepareSettings?(): void
    onConfigure?(id: string, value: string): void
    permissions?: Snapshot["permissions"]
    onPermission?(id: string, optionId: string): void
    executorId?: string | undefined
    executors?: readonly Pick<Snapshot, "executorId" | "executorLabel" | "status" | "pending">[] | undefined
    pendingTasks?: number | undefined
    managingExecutors?: boolean | undefined
    onSelectExecutor?(id: string): void
    onCreateExecutor?(label: string): void | Promise<void>
  }>
}
