import type {StorybookAppMcpTools} from "@zavx0z/storybook-app-mcp-tools"

/**
Предмет, который доверенный хост разрешил по действующему Project.

@property address - Канонический адрес сущности в Project; `/` соответствует самому Project.

@property directory - Назначенная существующая директория, доступная только хосту.
Сохраняется в замыкании инструментов и не входит в bootstrap.

@property [type] - Тип, подтверждённый нормативным сценарием, либо Project для корня.
Отсутствие подтверждения сохраняет общую основу Package.
*/
export type Subject = Readonly<{
  address: string
  label: string
  directory: StorybookAppMcpTools.Input["directory"]
  type?: StorybookAppMcpTools.Input["type"]
}>

/**
Полный исходник действующего правила, выбранный доверенным хостом.

@property source - Путь источника относительно Project, без абсолютного файлового корня.

@property content - Исходный текст документа; доставка не создаёт копии файла политики.

@property [contentHash] - SHA-256 прочитанного содержимого для сопоставления редакций.
*/
export type Instruction = Readonly<{source: string, content: string, contentHash?: string}>

/**
Стартовый контекст одного исполнителя и описание его действительных возможностей.

@property executorId - Устойчивая identity, назначенная хостом независимо от предмета и provider session.

@property subject - Предмет и подтверждённый тип без файлового корня.

@property protocol - Русский протокол полного сообщения с командой и отложенного чтения подробностей.

@property tools - Описания ровно тех команд, которые исполняет это назначение.

@property knowledge - Точки входа отложенного чтения относительно неизменной области назначения.
Чтение начальной точки раскрывает доступные адреса в children.

@property instructions - Правила, прочитанные до выдачи назначения, в порядке от общих к локальным.
Снимок сохраняется для этого назначения; изменения файлов не обновляют контекст ранее запущенной сессии автоматически.
*/
export type Bootstrap = Readonly<{
  executorId: string
  /** Имя назначения, когда оно предоставлено владельцем беседы. */
  executorLabel?: string
  subject: Pick<Subject, "address" | "label" | "type">
  protocol: string
  tools: ReturnType<StorybookAppMcpTools.Output["list"]>
  knowledge: readonly Readonly<{path: string, description: string}>[]
  instructions: readonly Instruction[]
}>

/**
Назначение, выдаваемое исключительно доверенному хосту.

@property token - Эфемерный bearer для доставки команд одного назначения.
Не входит в bootstrap, инспекцию другого исполнителя или события вызовов.

@property bootstrap - Независимая копия стартового контекста для доставки исполнителю.
*/
export type Assignment = Readonly<{token: string, bootstrap: Bootstrap}>

/**
Выбор исполнителя и области доверенным хостом.

@property executorId - Непустая identity без начальных и завершающих пробелов.
Повтор активного или подготавливаемого назначения отклоняется.

@property address - Существующий канонический адрес, проверяемый resolve хоста.

@property [inspectExecutors] - Явное право читать bootstrap других активных исполнителей.
Допустимо только при назначении корневого Project; не даёт права исполнять чужие инструменты.
*/
export type AssignmentInput = Readonly<{
  executorId: string
  executorLabel?: string
  address: string
  inspectExecutors?: boolean
}>
