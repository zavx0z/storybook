import type {StorybookPackageBuildState} from "../sessions/package-session.ts"

/**
Переводит подтверждённые package events в текст существующей StatusBar.

Текст описывает только факт, уже опубликованный PackageSession. Он не выводит
проценты, не называет built revision применённой и не заменяет server startup
phases, которые browser до подключения не получает.

@param packageId - Exact identity пакета, к которому относится состояние.

@param type - Тип опубликованного события PackageSession.

@returns Короткое русское описание наблюдаемого этапа.
*/
export function packageEventStatus(_packageId: string, type: string): string {
  if (type === "package.code-updated") return "Пакет · Изменения обнаружены; подготовка следующей сборки"
  if (type === "package.resources-updated") return "Пакет · Ресурсы изменены; подготовка следующей сборки"
  if (type === "package.metadata-updated") return "Пакет · Структура изменена; подготовка следующей сборки"
  if (type === "package.built") return "Пакет · Кандидат собран; ожидание проверки и применения"
  if (type === "package.activating") return "Пакет · Проверка и применение кандидата"
  if (type === "package.updated") return "Пакет · Новая ревизия готова"
  if (type === "package.failed") return "Пакет · Ошибка обработки"
  if (type === "package.detached") return "Пакет · Отключён"
  return "Пакет · Состояние обновлено"
}

/**
Переводит восстановленный снимок PackageSession в StatusBar text.

@param packageId - Exact identity пакета из snapshot.

@param state - Текущее состояние, полученное после восстановления соединения.

@returns Русское описание реально восстановленного session state.
*/
export function packageBuildStatus(_packageId: string, state: StorybookPackageBuildState): string {
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
}

/** Отражает наблюдаемое состояние browser WebSocket без private connection data. */
export function storybookConnectionStatus(
  state: "connecting" | "connected" | "reconnected" | "disconnected",
): string {
  if (state === "connecting") return "Storybook · Подключение к серверу"
  if (state === "connected") return "Storybook · Соединение установлено; синхронизация"
  if (state === "reconnected") return "Storybook · Соединение восстановлено; синхронизация"
  return "Storybook · Соединение с сервером потеряно; ожидание восстановления"
}
