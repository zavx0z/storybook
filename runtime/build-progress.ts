import type {
  StorybookBuildCacheLayer,
  StorybookBuildCacheStatus,
  StorybookBuildPhase,
  StorybookBuildReason,
  StorybookBuildTransition,
} from "../build/build-scheduler.ts"

const phaseLabels = Object.freeze({
  discovery: "Поиск и разбор каталога",
  admission: "Подготовка компилятора",
  cache: "Проверка сохранённой сборки",
  fingerprint: "Проверка входов и ресурсов",
  resources: "Проверка и публикация ресурсов",
  exports: "Проверка экспортов",
  bundle: "Компиляция интерфейса",
  kernel: "Сборка общих модулей",
  host: "Сборка оболочки Storybook",
  "protocol-build": "Компиляция проверки протокола",
  "protocol-run": "Проверка протокола",
  publish: "Локальная публикация ревизии",
} satisfies Record<StorybookBuildPhase, string>)

const reasonLabels = Object.freeze({
  missing: "нужна первая сборка",
  "input-changed": "изменились входы",
  "receipt-unverified": "нужна проверка сохранённого результата",
  "explicit-retry": "запрошена повторная сборка",
  "toolchain-changed": "изменился инструмент сборки",
} satisfies Record<StorybookBuildReason, string>)

type PublishedBuildProgress = StorybookBuildTransition & Readonly<{
  reason?: StorybookBuildReason
  cache?: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>
}>

/** Переход catalog refresh, публикуемый только вокруг фактического resolver pass. */
export type StorybookCatalogProgress = Readonly<{
  type: "catalog.progress"
  state: "running" | "completed" | "failed"
}>

/** Проверка уже загруженной shared оболочки вне scheduler не создаёт фиктивную job. */
export type StorybookSharedCacheProgress = Readonly<{
  type: "shared.cache-progress"
  state: "started" | "completed"
  hit?: boolean
}>

/**
Проверяет полученный переход очереди перед обновлением информационной панели.

@param value - Неисполняемые данные события WebSocket.

@returns Событие с допустимыми состоянием и фазой либо null для неизвестных данных.
*/
export function readBuildProgress(value: unknown): PublishedBuildProgress | null {
  if (value === null || typeof value !== "object") return null
  const event = value as Record<string, unknown>
  if (event.type !== "build.progress" || typeof event.operationId !== "string" ||
    !/^[A-Za-z0-9_-]{1,256}$/u.test(event.operationId) ||
    typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at)) ||
    !["open", "check", "watch", "subscribe", "startup-validation", "shared"].includes(String(event.owner)) ||
    event.packageId !== null && typeof event.packageId !== "string" ||
    event.generation !== null && (!Number.isSafeInteger(event.generation) || Number(event.generation) < 0) ||
    typeof event.phase !== "string" || !Object.hasOwn(phaseLabels, event.phase) ||
    !["queued", "running", "canceling", "completed"].includes(String(event.state)) ||
    event.reason !== undefined && !Object.hasOwn(reasonLabels, String(event.reason)) ||
    event.cache !== undefined && !validCache(event.cache)) return null
  if (event.state === "completed" && !["completed", "failed", "canceled", "timed-out"].includes(String(event.outcome))) return null
  return value as PublishedBuildProgress
}

/** Принимает ограниченное событие actual catalog refresh, без scope paths и identities. */
export function readCatalogProgress(value: unknown): StorybookCatalogProgress | null {
  if (value === null || typeof value !== "object") return null
  const event = value as Record<string, unknown>
  return event.type === "catalog.progress" && ["running", "completed", "failed"].includes(String(event.state))
    ? event as StorybookCatalogProgress
    : null
}

/** Принимает bounded факт проверки горячего shared cache. */
export function readSharedCacheProgress(value: unknown): StorybookSharedCacheProgress | null {
  if (value === null || typeof value !== "object") return null
  const event = value as Record<string, unknown>
  if (event.type !== "shared.cache-progress" ||
    (event.state !== "started" && event.state !== "completed") ||
    event.hit !== undefined && typeof event.hit !== "boolean") return null
  if (event.state === "started" && event.hit !== undefined) return null
  if (event.state === "completed" && typeof event.hit !== "boolean") return null
  return event as StorybookSharedCacheProgress
}

/**
Описывает реально наблюдаемый этап; успешная компиляция не означает применение.

@param event - Проверенный переход очереди текущего пакета либо общей оболочки.

@returns Краткий текст существующей информационной панели.
*/
export function buildProgressStatus(event: PublishedBuildProgress): string {
  const owner = event.packageId === null ? "Оболочка Storybook" : "Пакет"
  if (event.state === "queued") {
    const reason = event.reason === undefined ? "ожидается работа" : reasonLabels[event.reason]
    return `${owner} · Ожидание очереди сборки; ${reason}`
  }
  if (event.state === "canceling") return `${owner} · Отмена; ожидание завершения текущей работы`
  if (event.state === "completed") {
    if (event.outcome === "failed") return `${owner} · Ошибка обработки`
    if (event.outcome === "canceled") return `${owner} · Сборка отменена`
    if (event.outcome === "timed-out") return `${owner} · Превышен срок выполнения`
    if (event.packageId === null) return `${owner} · Локальные ресурсы готовы`
    return `${owner} · Кандидат собран; ожидание проверки и применения`
  }
  if (event.phase === "cache") {
    if (event.cache?.status === "hit") return `${owner} · Сохранённая сборка подтверждена`
    if (event.cache?.status === "miss") return `${owner} · Сохранённая сборка не подходит; полная сборка`
    return `${owner} · Проверка сохранённой сборки`
  }
  if (event.phase === "fingerprint" && event.reason === "receipt-unverified") {
    return `${owner} · Проверка входов и сохранённого результата`
  }
  return `${owner} · ${phaseLabels[event.phase]}`
}

/** Описывает только границы фактически исполненного catalog refresh. */
export function catalogProgressStatus(event: StorybookCatalogProgress): string {
  if (event.state === "running") return "Каталог · Поиск пакетов и чтение деклараций"
  if (event.state === "completed") return "Каталог · Структура обновлена"
  return "Каталог · Ошибка обновления структуры"
}

/** Описывает только действительную проверку in-memory shared cache. */
export function sharedCacheProgressStatus(event: StorybookSharedCacheProgress): string {
  if (event.state === "started") return "Оболочка Storybook · Проверка текущей сборки"
  return event.hit === true
    ? "Оболочка Storybook · Текущая сборка подтверждена"
    : "Оболочка Storybook · Текущая сборка устарела; подготовка новой"
}

function validCache(value: unknown): value is Readonly<{
  status: StorybookBuildCacheStatus
  layer: StorybookBuildCacheLayer
}> {
  if (value === null || typeof value !== "object") return false
  const cache = value as Record<string, unknown>
  return ["hit", "miss", "bypass", "unknown"].includes(String(cache.status)) &&
    ["receipt", "protocol", "package", "shared"].includes(String(cache.layer))
}
