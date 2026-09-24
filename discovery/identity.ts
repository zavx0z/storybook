/** Проверяет package identity и имена публичных экспортов структурных сценариев. */
export const EXTERNAL_STORYBOOK_PACKAGE_ID_PATTERN = "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$" as const
const packageIdPattern = new RegExp(EXTERNAL_STORYBOOK_PACKAGE_ID_PATTERN, "u")
const exportPattern = /^(?:default|[$A-Z_a-z][$0-9A-Z_a-z]*)$/u

/** One exact production package identity law shared by every adapter. */
export function validateExternalStorybookPackageId(value: unknown, label: string): string {
  const id = requiredText(value, label)
  if (!packageIdPattern.test(id)) throw new Error(`${label} must be an exact package name: ${id}`)
  return id
}

/** One importable ESM export-name law for resolver, loader and protocol child. */
export function validateExternalStorybookExportName(value: unknown, label: string): string {
  const name = requiredText(value, label)
  if (!exportPattern.test(name)) throw new Error(`${label} must be an importable ESM export name: ${name}`)
  return name
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 ||
    /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be non-empty text without control characters`)
  }
  return value
}
