import type {
  NewSessionRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from "@agentclientprotocol/sdk"

/** Контракт долгоживущего ACP-подключения одного владельца сессии. */
export declare namespace TechAcp {
  /**
  Подключение к агенту со штатными типами ACP SDK.

  @property cwd - Абсолютный существующий каталог исполнения данной сессии.
  Не является самостоятельным ограничением файлового доступа агента.

  @property mcpServers - Только MCP-серверы, подготовленные вызывающим владельцем.
  Транспорт передаёт их без изменения предметных адресов и полномочий.

  @property [previousSessionId] - Восстанавливаемая ACP-сессия.
  Отсутствие поддержки восстановления вызывает ошибку; новый контекст вместо
  указанного старого не создаётся. Обновления replay не передаются в onUpdate.

  @property onUpdate - Принимает исходный SessionUpdate текущей сессии.
  История, адресная принадлежность и представление остаются у вызывающего кода.

  @property onPermission - Явно отвечает на запрос агента средствами ACP.
  Транспорт не выбирает разрешение автоматически.

  @property [command] - Подставленный executable вместо установленного адаптера.
  Предназначен также для изолированной проверки на отдельном fake process.

  @property [args] - Аргументы подставленного executable без shell-интерпретации.

  @property [env] - Дополнительные переменные только дочернего процесса.
  Переменные текущего процесса и его credentials не изменяются; transient
  Desktop IPC и identity родительской задачи не передаются отдельной ACP-сессии.

  @property [mode] - Штатный preset Codex адаптера для этой сессии.
  workspace-write использует approval on-request с решением пользователя.
  При отсутствии preset выбирается самим адаптером; транспорт не заявляет
  адресную изоляцию native filesystem или глобально настроенных MCP.

  @property [config] - Штатный CODEX_CONFIG для thread/start и thread/resume.
  Доставляется как JSON только этому процессу; dotted keys позволяют выразить
  индивидуальные overrides native Codex без выдуманного CLI-контракта.
  Переданный объект заменяет CODEX_CONFIG из env, credentials не изменяются.

  @property [signal] - Время жизни соединения, включая его подготовку.
  Отмена закрывает transport и освобождает точный дочерний процесс.

  @property [exclusiveMcp] - Явно подготавливает native registry для переданного списка.
  Read-only CLI адаптера читает имена настроенных серверов в данном cwd;
  launcher передаёт disabled overrides и plugins=false ещё до native bootstrap.
  Затем session config включает только назначенные имена с их реальным proxy.
  Глобальные настройки и HOME не изменяются. Native filesystem определяется
  отдельно mode/cwd; глобальный service inventory не подменяет набор tools сессии.

  @property [installation] - Абсолютный корень установленного инструмента Storybook.
  Адаптер разрешается относительно его package.json, независимо от cwd проекта
  и каталога bundle/artifact. Без значения используется текущий исходный модуль.
  */
  type Input = Readonly<{
    cwd: string
    mcpServers: NewSessionRequest["mcpServers"]
    previousSessionId?: string
    onUpdate(update: SessionUpdate): void | Promise<void>
    onPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse>
    command?: string
    args?: readonly string[]
    env?: Readonly<Record<string, string | undefined>>
    mode?: "read-only" | "workspace-write"
    config?: Readonly<Record<string, unknown>>
    signal?: AbortSignal
    exclusiveMcp?: boolean
    installation?: string
  }>

  /**
  Сессия и принадлежащий ей процесс ACP.

  @property sessionId - Фактически созданная либо восстановленная ACP identity.

  @property prompt - Запускает один turn и возвращает реальный stopReason агента.
  Параллельный prompt той же сессии отклоняется; отмена выполняется через cancel.

  @property cancel - Отправляет session/cancel активной сессии.
  Завершение отправки не подменяет итог текущего prompt.

  @property dispose - Закрывает transport и подтверждает выход дочернего процесса.
  Повторные вызовы разделяют одно завершение; после начала disposal новые вызовы
  отклоняются. Владение историей чата сюда не передаётся.
  */
  type Output = Readonly<{
    sessionId: string
    prompt(text: string): Promise<PromptResponse>
    cancel(): Promise<void>
    dispose(): Promise<void>
  }>
}
