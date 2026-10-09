/**
Отличает уход страницы от ошибки кандидата по собственным сообщениям границы view.
Произвольный AbortError или ошибка монтирования не считаются уходом пользователя.
*/
export function isStorybookNavigationSupersededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Storybook view navigated to another package") ||
    message.includes("Storybook view navigated away from the requested package") ||
    message.includes("Storybook environment following was disabled") ||
    message.includes("Storybook environment following was superseded")
}
