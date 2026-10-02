/** Режим загрузки связывает цель с правом автоматического применения ревизии. */
export type Intent = "reader" | "navigation-candidate" | "preview"

/**
Подготовленная сервером цель package scope.

@property kind - revision несёт неизменный payload; fallback показывает пакет без доступной ревизии.

@property packageId - Точный владелец графа, runtime, socket subscription и diagnostics.

@property revision - Загружаемая ревизия; null допустим для fallback.

@property revisionUrl - Неизменный базовый адрес ресурсов этой ревизии.

@property [payloadUrl] - Диагностический точный адрес payload без побочных эффектов; загрузку выполняет потребитель.

@property urlPath - Разрешённый сервером публичный адрес route; не восстанавливается из packageId.

@property intent - Различает reader, navigation candidate и явный preview.

@property preview - Запрещает автоматическое применение для reader grant независимо от query после commit.

@property initialAppliedRevision - Фактически применённая ревизия до проверки candidate.

@property fallbackRevision - Рабочая ревизия для восстановления после ошибки candidate.

@property readerToken - Одноразовый token точной package subscription и revision lease.
*/
export type PackageTarget = Readonly<{
  kind: "revision" | "fallback"
  packageId: string
  revision: string | null
  revisionUrl: string | null
  payloadUrl?: string | null
  route: string
  urlPath: string
  intent: Intent
  preview: boolean
  initialAppliedRevision: string | null
  fallbackRevision: string | null
  readerToken: string
}>

/**
Серверная цель landing scope без права подписки на package topics.

@property pathname - Признанный сервером адрес landing для staged history.

@property readerToken - Token registry subscription.
*/
export type LandingTarget = Readonly<{
  kind: "landing"
  pathname: string
  readerToken: string
}>

/** Серверная цель одного атомарного перехода страницы. */
export type Target = PackageTarget | LandingTarget

/**
Запрос цели без локального выбора built, active или рабочей ревизии.

@property packageId - Точный пакет либо null для landing.

@property route - Package route или landing pathname; разрешение выполняет сервер.

@property intent - preview требует requestedRevision; navigation оставляет политику ревизий серверу.

@property [requestedRevision] - Ограниченный opaque token только для явного preview.
*/
export type PrepareInput = Readonly<{
  packageId: string | null
  route: string
  intent: "navigation" | "preview"
  requestedRevision?: string
}>
