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

/** Сохранение переносимых настроек среды без запуска исполнителей. */
export declare namespace StorybookAppSettings {
  /** Project задаёт место общего файла; subject приходит от доверенного resolver. */
  type Input = Readonly<{project: string}>
  type Output = Readonly<{
    read(): Promise<Document>
    /** Полная замена настроек при совпадении текущей revision; неизвестные подключения отклоняются. */
    update(input: Omit<Document, "schemaVersion" | "revision"> & Readonly<{revision: number}>): Promise<Document>
    readExecutor(input: ExecutorInput): Promise<Selection>
    /** Полная замена override агента; пустой объект возвращает наследование. */
    updateExecutor(input: ExecutorInput & Readonly<{selection: Selection}>): Promise<void>
    /** Разрешает general → подтверждённый тип → агент → беседа по каждому полю отдельно. */
    resolve(input: ExecutorInput & Readonly<{selection: Selection, executorSelection?: Selection, pinnedConnectionId?: string}>): Promise<Execution>
  }>
}
