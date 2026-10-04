/**
Показывает подтверждённые этапы сборки, каталога и соединения страницы.
Полученные события проверяются перед отображением; собранный кандидат сохраняет
отличие от применённой ревизии. Этот владелец не запускает работу и не меняет сессии.

@packageDocumentation
*/
import type {Zavx0zStorybookAppWebPageStatus} from "./contract"
import type {BuildProgress, CatalogProgress} from "./contract/progress"
import type {PackageBuildState} from "./contract/package"
import {phaseLabels, reasonLabels} from "./src/labels"
import {validCache} from "./src/cache"
export type {Zavx0zStorybookAppWebPageStatus} from "./contract"

const status: Zavx0zStorybookAppWebPageStatus.Output = Object.freeze<Zavx0zStorybookAppWebPageStatus.Output>({
  /**
Проверяет полученный переход очереди перед обновлением информационной панели.

@param value - Неисполняемые данные события WebSocket.

@returns Событие с допустимыми состоянием и фазой либо null для неизвестных данных.
*/
  readBuild(value: unknown): BuildProgress | null {
    if (value === null || typeof value !== "object") return null
    const event = value as Record<string, unknown>
    if (event.type !== "build.progress" || typeof event.operationId !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/u.test(event.operationId) ||
      typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at)) ||
      !["open", "check", "subscribe", "startup-validation", "shared"].includes(String(event.owner)) ||
      event.packageId !== null && typeof event.packageId !== "string" ||
      event.generation !== null && (!Number.isSafeInteger(event.generation) || Number(event.generation) < 0) ||
      typeof event.phase !== "string" || !Object.hasOwn(phaseLabels, event.phase) ||
      !["queued", "running", "canceling", "completed"].includes(String(event.state)) ||
      event.reason !== undefined && !Object.hasOwn(reasonLabels, String(event.reason)) ||
      event.cache !== undefined && !validCache(event.cache)) return null
    if (event.state === "completed" && !["completed", "failed", "canceled", "timed-out"].includes(String(event.outcome))) return null
    return value as BuildProgress
  },

  /** Принимает ограниченное событие actual catalog refresh, без scope paths и identities. */
  readCatalog(value: unknown): CatalogProgress | null {
    if (value === null || typeof value !== "object") return null
    const event = value as Record<string, unknown>
    return event.type === "catalog.progress" && ["running", "completed", "failed"].includes(String(event.state))
      ? event as CatalogProgress
      : null
  },

  /**
Описывает реально наблюдаемый этап; успешная компиляция не означает применение.

@param event - Проверенный переход очереди текущего пакета либо общей оболочки.

@returns Краткий текст существующей информационной панели.
*/
  build(event: BuildProgress): string {
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
    return `${owner} · ${phaseLabels[event.phase]}`
  },

  /** Описывает только границы фактически исполненного catalog refresh. */
  catalog(event: CatalogProgress): string {
    if (event.state === "running") return "Каталог · Поиск пакетов и чтение деклараций"
    if (event.state === "completed") return "Каталог · Структура обновлена"
    return "Каталог · Ошибка обновления структуры"
  },

  /**
Переводит подтверждённые package events в текст существующей StatusBar.

Текст описывает только факт, уже опубликованный Zavx0zStorybookPackageSession. Он не выводит
проценты, не называет built revision применённой и не заменяет server startup
phases, которые browser до подключения не получает.

@param packageId - Exact identity пакета, к которому относится состояние.

@param type - Тип опубликованного события Zavx0zStorybookPackageSession.

@returns Короткое русское описание наблюдаемого этапа.
*/
  packageEvent(_packageId: string, type: string): string {
    if (type === "package.code-updated") return "Пакет · Изменения обнаружены; подготовка следующей сборки"
    if (type === "package.resources-updated") return "Пакет · Ресурсы изменены; подготовка следующей сборки"
    if (type === "package.metadata-updated") return "Пакет · Структура изменена; подготовка следующей сборки"
    if (type === "package.built") return "Пакет · Кандидат собран; ожидание проверки и применения"
    if (type === "package.activating") return "Пакет · Проверка и применение кандидата"
    if (type === "package.updated") return "Пакет · Новая ревизия готова"
    if (type === "package.failed") return "Пакет · Ошибка обработки"
    if (type === "package.detached") return "Пакет · Отключён"
    return "Пакет · Состояние обновлено"
  },

  /**
Переводит восстановленный снимок Zavx0zStorybookPackageSession в StatusBar text.

@param packageId - Exact identity пакета из snapshot.

@param state - Текущее состояние, полученное после восстановления соединения.

@returns Русское описание реально восстановленного session state.
*/
  packageBuild(_packageId: string, state: PackageBuildState): string {
    if (state === "idle") return "Пакет · Ожидание изменений"
    if (state === "queued") return "Пакет · Ожидание очереди сборки"
    if (state === "compiling") return "Пакет · Сборка выполняется"
    if (state === "building") return "Пакет · Проверка входов и ресурсов"
    if (state === "built") return "Пакет · Кандидат собран; ожидание проверки и применения"
    if (state === "activating") return "Пакет · Проверка и применение кандидата"
    if (state === "active") return "Пакет · Текущая ревизия готова"
    if (state === "failed") return "Пакет · Ошибка обработки"
    if (state === "disposed") return "Пакет · Отключён"
    return "Пакет · Готов к запуску"
  },

  /** Отражает наблюдаемое состояние browser WebSocket без private connection data. */
  connection(
  state: "connecting" | "connected" | "reconnected" | "disconnected",
): string {
    if (state === "connecting") return "Storybook · Подключение к серверу"
    if (state === "connected") return "Storybook · Соединение установлено; синхронизация"
    if (state === "reconnected") return "Storybook · Соединение восстановлено; синхронизация"
    return "Storybook · Соединение с сервером потеряно; ожидание восстановления"
  },
})

export default status
