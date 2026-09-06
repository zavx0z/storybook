/** Ordered Workbench + active-package author stylesheet composition. */

export type StorybookAuthorStyleSheetIdentity = Readonly<{
  specifier: string
  contentDigest: string
}>

/**
 * Keeps the fixed Workbench order before package resources, collapses an exact
 * repeated specifier/content identity to one sheet and rejects split ownership
 * of one public specifier with different bytes.
 */
export function mergeStorybookAuthorStyleSheets<
  StyleSheet extends StorybookAuthorStyleSheetIdentity,
>(
  workbench: readonly StyleSheet[],
  activePackage: readonly StyleSheet[],
): readonly StyleSheet[] {
  if (!Array.isArray(workbench) || !Array.isArray(activePackage)) {
    throw new TypeError("Storybook author stylesheet collections must be lists")
  }
  const bySpecifier = new Map<string, StyleSheet>()
  const output: StyleSheet[] = []
  for (const [owner, styleSheets] of [
    ["Workbench", workbench],
    ["active package", activePackage],
  ] as const) {
    for (const [index, styleSheet] of styleSheets.entries()) {
      const specifier = exactText(styleSheet?.specifier, `${owner} author stylesheet ${index} specifier`)
      const contentDigest = exactDigest(
        styleSheet?.contentDigest,
        `${owner} author stylesheet ${specifier} digest`,
      )
      const previous = bySpecifier.get(specifier)
      if (previous === undefined) {
        bySpecifier.set(specifier, styleSheet)
        output.push(styleSheet)
        continue
      }
      if (previous.contentDigest !== contentDigest) {
        throw new Error(
          `Conflicting Storybook author stylesheet content for specifier: ${specifier}`,
        )
      }
    }
  }
  return Object.freeze(output)
}

function exactText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-empty text`)
  }
  return value
}

function exactDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a SHA-256 digest`)
  }
  return value
}
