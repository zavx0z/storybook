export async function requestPackageView(
  fetcher: typeof fetch,
  browserDocument: globalThis.Document,
  input: Readonly<{packageId: string; route: string}>,
): Promise<void> {
  const session = browserDocument.querySelector<HTMLMetaElement>(
    'meta[name="external-storybook-browser-session"]',
  )?.content
  if (session === undefined || session.length === 0) {
    throw new Error("External Storybook landing has no browser session")
  }
  const response = await fetcher("/api/browser/open", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-storybook-session": session,
    },
    body: JSON.stringify(input),
  })
  const result = await response.json().catch(() => null) as unknown
  if (!response.ok || result === null || typeof result !== "object" || (result as Record<string, unknown>).ok !== true) {
    const message = result !== null && typeof result === "object" &&
      typeof (result as Record<string, unknown>).error === "string"
      ? (result as Record<string, unknown>).error as string
      : `External Storybook package view request failed with ${response.status}`
    throw new Error(message)
  }
}
