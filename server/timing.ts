/** Fresh package compile budget on the supported Intel development host. */
export const STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS = 120_000

/**
Холодная общая сборка выполняет четыре native прохода с независимыми JSX/TypeScript sessions.
Конечный бюджет покрывает полный граф самостоятельных UI-пакетов на поддерживаемом Intel host.
*/
export const STORYBOOK_SHARED_COMPILE_TIMEOUT_MS = 480_000

/** Бюджет холодного запуска с разбором сохранённого каталога и TypeScript-контрактов. */
export const STORYBOOK_SERVER_START_TIMEOUT_MS = 120_000

/** Keeps the HTTP request alive through compile timeout cleanup and its response. */
export const STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS = 125
