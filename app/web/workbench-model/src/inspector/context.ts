/** Адресный контекст Storybook; транспорт остаётся подменяемым для проверки browser API. */
export type WorkbenchChatContext = Readonly<{
  address: string
  label: string
  fetcher?: typeof fetch
}>
