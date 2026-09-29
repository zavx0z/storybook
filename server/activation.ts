/** Точная package revision, допущенная к явной серверной проверке. */
export type StorybookActivationCandidate = Readonly<{
  packageId: string
  revision: string
}>

/**
Отличает уход страницы от ошибки кандидата по собственным сообщениям границы view.
Произвольный AbortError или ошибка монтирования не считаются уходом пользователя.
*/
export function isStorybookNavigationSupersededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Storybook view navigated to another package") ||
    message.includes("Storybook view navigated away from the requested package")
}

/**
Проверяет полный browser evidence перед server-side acknowledgement.

@throws Если package, revision, route, graph, ready/presented frame либо console
не подтверждают exact candidate.
*/
export function assertStorybookActivationEvidence(
  evidence: Readonly<Record<string, unknown>>,
  expected: Readonly<{packageId: string, revision: string, route: string, graphDigest: string}>,
): number {
  const frameSequence = Number(evidence.frameSequence)
  if (evidence.packageId !== expected.packageId || evidence.revision !== expected.revision ||
    evidence.route !== expected.route || evidence.graphDigest !== expected.graphDigest ||
    evidence.ready !== true || evidence.presented !== true || !Number.isSafeInteger(frameSequence) ||
    frameSequence < 1 || !Array.isArray(evidence.consoleErrors) || evidence.consoleErrors.length > 0) {
    throw new Error(`Package candidate did not pass activation verification: ${expected.packageId}`)
  }
  return frameSequence
}
