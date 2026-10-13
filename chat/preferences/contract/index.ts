import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type Execution = NonNullable<Snapshot["execution"]>

/** Выбор подключения, модели и мышления с явным возвратом к наследованию. */
export declare namespace StorybookChatPreferences {
  type Field = "connectionId" | "model" | "thoughtLevel" | "approvalMode"
  /**
  Поля принадлежат переданному уровню настроек; пустое значение удаляет override.
  Выбор провайдера виден даже при одном подключении. Его изменение сбрасывает
  модель и мышление; изменение модели сбрасывает мышление.
  Варианты модели и мышления предоставляет исполнитель. Неполученные варианты
  не заменяются догадками, а сохранённый недоступный выбор остаётся видимым.
  */
  type Input = Readonly<{
    selection: Execution["selection"]
    effective?: Execution["effective"] | undefined
    sources?: Execution["sources"] | undefined
    /** Каталог представления: widget не читает endpoint, credentials или transport policy. */
    connections: readonly Readonly<{id: string; label: string; enabled: boolean}>[]
    settings: NonNullable<Snapshot["settings"]>
    inheritLabel?: string | undefined
    busy?: boolean | undefined
    /** Отсутствие сохраняет полный прежний набор; host раскрывает только принадлежащие ему поля. */
    fields?: readonly Field[] | undefined
    disabledFields?: readonly Field[] | undefined
    onChange(value: Execution["selection"]): void
  }>
}
