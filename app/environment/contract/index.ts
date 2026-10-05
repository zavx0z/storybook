import type {Subject, AssignmentInput, Assignment, Instruction} from "./context"
import type {CallEvent} from "./events"
import type {StorybookAppMcpTools} from "@zavx0z/storybook-app-mcp-tools"

/** Назначение и исполнение окружения независимо от модели и транспорта её сессии. */
export declare namespace StorybookAppEnvironment {
  /**
  Возможности доверенного хоста текущего Project.

  @property resolve - Проверяет существование адреса и возвращает принадлежащий ему контекст.
  Используется только при назначении, до создания неизменяемых файловых инструментов.

  @property readKnowledge - Читает предметную проекцию address с учётом общих правил хоста.
  path отсчитывается от назначения. Callback используется только для knowledge.read,
  сохраняет существующие reader, lazy loading и единственный источник нормативных ссылок.
  Возвращает HTTP-ответ предметного читателя; успешное тело является JSON-объектом.

  @property [onCall] - Получает независимые события начала и завершения валидной команды.
  Промежуточные progress сохраняют тот же id и не заменяют итог success/failed.
  Синхронный throw или отклонённый Promise наблюдателя не меняют результат исполнения.
  Хост отвечает за хранение, очистку диагностических данных и завершение своих записей.

  @property [instructions] - Читает правила назначенного предмета до выдачи bearer и первого prompt.
  Возвращает полные исходники с относительными Project путями; отсутствие callback даёт пустой список.
  Доставка правил не изменяет файловую область или права инспекции.
  */
  type Input = Readonly<{
    resolve(address: string): Subject | Promise<Subject>
    instructions?(input: Readonly<{executorId: string, subject: Subject, inspectExecutors: boolean}>): readonly Instruction[] | Promise<readonly Instruction[]>
    readKnowledge(input: Readonly<{address: string, path?: string, signal: AbortSignal}>): Promise<Response>
    /** Предметный владелец добавляет инструменты конкретного назначения до выдачи bootstrap. */
    extensions?(input: Readonly<{executorId: string, subject: Subject, inspectExecutors: boolean}>): StorybookAppMcpTools.Input["extensions"] | Promise<StorybookAppMcpTools.Input["extensions"]>
    onCall?(event: CallEvent): void | Promise<void>
    /** Необязательная штатная доставка NDJSON; execute возвращает ту же result/error оболочку, что JSON. */
    stream?(signal: AbortSignal, subscribe: (listener: (progress: Readonly<Record<string, unknown>>) => void) => () => void,
      execute: () => Promise<Record<string, unknown>>): Response
  }>

  /**
  Самостоятельная runtime-область назначений и единый обработчик запросов.

  @property assign - Назначает устойчивому executorId проверенный предмет.
  Возвращает хосту bearer и bootstrap; несколько executorId могут работать с одним предметом.
  Дубли identity, несовпадение разрешённого адреса и права инспекции вне Project отклоняются.

  @property revoke - Отзывает активное или подготавливаемое назначение executorId.
  Возвращает true при существующем назначении; повторный отзыв возвращает false.
  Старый bearer больше не авторизует вызовы, в том числе после повторного назначения identity.
  Уже начатый инструмент не откатывается.

  @property handle - GET возвращает bootstrap, POST исполняет одну точную команду name/arguments.
  Оба требуют bearer; путь endpoint и Host/Origin проверяет сервер до обращения к обработчику.
  Query запрещён, тело ограничено 16 МиБ; результаты сохраняют полное содержимое инструментов.
  Accept application/x-ndjson использует предоставленную хостом stream-доставку:
  progress передаются до финального result с той же JSON-оболочкой.
  Отвечает оболочкой result либо error, внутренний id возвращается как x-request-id.
  knowledge.read читает только назначенную проекцию. environment.inspect принимает executorId
  и необязательный path; доступен только явно назначенному инспектору Project.
  Без path возвращает bootstrap цели без её bearer. При path добавляет document —
  результат того же предметного reader относительно точки входа цели, включая её правила.
  Инспекция не меняет собственную область разработчика и проверяет сохранность назначения
  цели и права инспектора перед выдачей прочитанного документа.

  @property dispose - Отзывает все назначения и запрещает новые.
  Повторный вызов безопасен; создание не запускает listener, процесс модели или MCP runtime.
  */
  type Output = Readonly<{
    assign(input: AssignmentInput): Promise<Assignment>
    revoke(executorId: string): boolean
    handle(request: Request): Promise<Response>
    dispose(): void
  }>
}
