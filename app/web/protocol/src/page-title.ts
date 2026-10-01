/** Page titles follow the selected owner label; the unselected application has its own title. */
export function externalStorybookPageTitle(packageId: string | null, packageLabel?: string): string {
  if (packageId === null && packageLabel === undefined) return "Storybook"
  if (typeof packageLabel !== "string" || packageLabel.trim().length === 0) {
    throw new Error(`External Storybook package page title requires a label: ${packageId}`)
  }
  return packageLabel
}
