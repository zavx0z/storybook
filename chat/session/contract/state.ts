/**
Сообщение в сохранённой истории беседы.

@property id - Стабильный ключ сообщения; повторная доставка не создаёт новый элемент.
@property role - Автор текста: человек, исполнитель или состояние системы.
@property text - Текст сообщения; части одного ответа последовательно дополняют его.
*/
export type Message = Readonly<{
  id: string
  role: "user" | "assistant" | "system"
  text: string
}>

/**
Запрос исполнителя, ожидающий явного решения человека.

@property id - Ключ текущего запроса в одной беседе.
@property title - Описание предлагаемого действия, полученное от исполнителя.
@property options - Разрешённые исполнителем варианты: их идентификаторы и подписи.
*/
export type Permission = Readonly<{
  id: string
  title: string
  options: readonly Readonly<{id: string, name: string}>[]
}>

/** Выбор модели или мышления из предоставленных агентом вариантов. */
export type Setting = Readonly<{
  id: string
  category: "model" | "thought_level"
  name: string
  value: string
  options: readonly Readonly<{value: string; name: string; description?: string}>[]
}>

/** Последнее подтверждённое агентом заполнение контекстного окна. */
export type ContextUsage = Readonly<{used: number; size: number}>

/**
Публичное состояние беседы без секретов подключения и внутренних идентификаторов ACP.

@property id - Identity беседы, сохраняемая вместе с её историей.
@property address - Канонический путь предмета внутри Project, включая `/` для самого проекта.
@property label - Имя предмета из текущего каталога.
@property messages - История в порядке отправки и получения.
@property status - Готовность беседы, подключение, исполнение либо подтверждённая ошибка.
@property error - Текущая ошибка; null означает её отсутствие.
@property permissions - Запросы, ожидающие явного решения пользователя.
@property version - Возрастающий номер снимка в текущем процессе сервера.
После переподключения исходный снимок начинает новое наблюдение этой же беседы.
*/
export type Snapshot = Readonly<{
  id: string
  address: string
  label: string
  messages: readonly Message[]
  status: "idle" | "connecting" | "running" | "failed"
  error: string | null
  permissions: readonly Permission[]
  version: number
  /** Варианты появляются после подключения; пустой список не подменяется встроенным каталогом. */
  settings?: readonly Setting[]
  configuring?: boolean
  /** Текущий этап загрузки настроек или подключения агента. */
  progress?: string
  usage?: ContextUsage | null
}>

/**
Разрешённый адрес и его физический контекст, полученные из текущего каталога.

@property address - Точный публичный путь, проверенный по каталогу Project.
@property label - Человекочитаемое имя владельца беседы.
@property cwd - Существующий каталог предмета, задающий рабочий контекст исполнителя.
*/
export type Subject = Readonly<{address: string, label: string, cwd: string}>
