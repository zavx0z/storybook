import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

type Execution = NonNullable<Awaited<ReturnType<NonNullable<StorybookChatSession.Input["resolveExecution"]>>>>
type Selection = Execution["selection"]
type EntityType = "Project" | "Repo" | "Domain" | "Cluster" | "Container" | "Component"
type Subject = Readonly<{address: string, label: string, cwd: string, type?: EntityType}>
/** Версия защищает от записи устаревшего снимка HUD. */
type Document = Readonly<{
  schemaVersion: 1
  revision: number
  connections: Execution["connections"]
  general: Selection
  types: Readonly<Partial<Record<EntityType, Selection>>>
}>
type ExecutorInput = Readonly<{subject: Subject, executorId: string}>

/** Переносимые выборы и локальный каталог подключений, без запуска исполнителей. */
export declare namespace StorybookAppSettings {
  /**
  Project задаёт место общего файла и локального sidecar `.local/execution-connections.json`; subject приходит от доверенного resolver.
  Локальный каталог хранит current/previous снимки и активирует только revision
  переносимого документа; отказ его записи не активирует новый endpoint.
  Доверенная политика вне Project следует за физическим каталогом при rename
  на том же диске. Копия и перенос на другой диск не наследуют выданные права.
  */
  type Input = Readonly<{project: string, authorityDirectory?: string}>
  type Output = Readonly<{
    read(): Promise<Document>
    /** Полная замена настроек при совпадении текущей revision; неизвестные подключения отклоняются. */
    update(input: Omit<Document, "schemaVersion" | "revision"> & Readonly<{revision: number}>): Promise<Document>
    readExecutor(input: ExecutorInput): Promise<Selection>
    /** Полная замена override агента; пустой объект возвращает наследование. */
    updateExecutor(input: ExecutorInput & Readonly<{selection: Selection}>): Promise<void>
    /** Только доверенный управляющий канал: значение не читается из истории или файлов агента. */
    updateSessionApproval(input: Readonly<{sessionId: string, approvalMode?: Selection["approvalMode"]}>): Promise<void>
    /** Разрешает general → подтверждённый тип → агент → беседа. Смена провайдера сбрасывает модель и мышление; новая модель сбрасывает унаследованное мышление. Native подключение закрепляется до проверки выбора. */
    resolve(input: ExecutorInput & Readonly<{selection: Selection, sessionId?: string, executorSelection?: Selection, pinnedConnectionId?: string}>): Promise<Execution>
  }>
}
