import type {StorybookTechAcp} from "@storybook-tech/acp"
import type {Snapshot, Subject} from "./state"
import type {Relocation} from "./relocation"

/** Контракт адресных бесед одного Project. */
export declare namespace StorybookChatSession {
  /**
  Хранение и предоставленные приложением возможности исполнения.

  @property directory - Каталог историй внутри Project, независимый от cache и сборочных ревизий.
  @property resolve - Разрешает точный адрес по действующему каталогу и возвращает его владельца.
  @property connect - Создаёт ACP-подключение с контекстом указанного предмета при первом сообщении или явной подготовке настроек.
  */
  type Input = Readonly<{
    directory: string
    resolve(address: string): Subject
    connect(input: Readonly<{
      subject: Subject
      previousSessionId?: string
      signal: AbortSignal
      onProgress?: StorybookTechAcp.Input["onProgress"]
      onUpdate: StorybookTechAcp.Input["onUpdate"]
      onPermission: StorybookTechAcp.Input["onPermission"]
    }>): Promise<StorybookTechAcp.Output>
  }>

  /**
  История, поток состояния и действия над беседой.

  @property read - Читает историю, не запуская модель и не создавая пустой файл.
  @property prompt - Сохраняет сообщение и начинает один turn; requestId предотвращает повторную отправку.
  @property cancel - Запрашивает отмену только текущего turn выбранной беседы.
  @property permission - Разрешает ожидающий запрос ровно одним из переданных исполнителем вариантов.
  @property subscribe - Передаёт текущий снимок и изменения; отписка не отменяет выполнение.
  @property relocate - Переносит только явно названную историю на новый адрес,
  сохраняя id, сообщения и ACP sessionId. При активном turn или занятой цели
  отказывает без перезаписи. Старый файл остаётся для восстановления.
  @property dispose - Отменяет работу, закрывает подключения и дожидается записи историй.
  */
  type Output = Readonly<{
    read(address: string): Promise<Snapshot>
    /** Подключает агента для получения настроек без prompt и генерации ответа. */
    prepare(address: string): Promise<Snapshot>
    /** Меняет выбранную настройку вне turn; применённые значения подтверждает агент. */
    configure(address: string, id: string, value: string): Promise<Snapshot>
    prompt(address: string, text: string, requestId: string): Promise<Snapshot>
    cancel(address: string): Promise<Snapshot>
    permission(address: string, id: string, optionId: string): Promise<Snapshot>
    subscribe(address: string, listener: (value: Snapshot) => void): Promise<() => void>
    relocate(input: Relocation): Promise<Snapshot | null>
    dispose(): Promise<void>
  }>
}
