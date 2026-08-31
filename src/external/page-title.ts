const STORYBOOK_SELF_PACKAGE_ID = "@zavx0z/storybook"

/** Native page title belongs to realm content, never to the Storybook tool. */
export function externalStorybookPageTitle(
  packageId: string | null,
  packageLabel?: string,
): string {
  if (packageId === null || packageId === STORYBOOK_SELF_PACKAGE_ID) return "MetaFor"
  if (typeof packageLabel !== "string" || packageLabel.trim().length === 0) {
    throw new Error(`External Storybook package page title requires a label: ${packageId}`)
  }
  return packageLabel
}
