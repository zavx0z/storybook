export const EXTERNAL_STORYBOOK_SCOPE_ID_PATTERN = "^[a-z0-9]+(?:[._-][a-z0-9]+)*$" as const
export const EXTERNAL_STORYBOOK_PACKAGE_ID_PATTERN = "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$" as const
export const EXTERNAL_STORYBOOK_ROUTE_PATTERN = "^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*$" as const
export const EXTERNAL_STORYBOOK_EXPORT_PATTERN = "^(?:default|[$A-Z_a-z][$0-9A-Z_a-z]*)$" as const
export const EXTERNAL_STORYBOOK_MODULE_PATH_PATTERN = "^(?!/)(?![A-Za-z]:)(?!.*[\\\\?#\\u0000-\\u001F\\u007F]).+$" as const

const scopeIdPattern = new RegExp(EXTERNAL_STORYBOOK_SCOPE_ID_PATTERN, "u")
const packageIdPattern = new RegExp(EXTERNAL_STORYBOOK_PACKAGE_ID_PATTERN, "u")
const routePattern = new RegExp(EXTERNAL_STORYBOOK_ROUTE_PATTERN, "u")
const exportPattern = new RegExp(EXTERNAL_STORYBOOK_EXPORT_PATTERN, "u")
const modulePathPattern = new RegExp(EXTERNAL_STORYBOOK_MODULE_PATH_PATTERN, "u")

/** One law for workspace/project ids and package-local semantic ids. */
export function validateExternalStorybookScopeId(value: unknown, label: string): string {
  const id = requiredText(value, label)
  if (!scopeIdPattern.test(id)) throw new Error(`${label} is invalid: ${id}`)
  return id
}

/** One exact production package identity law shared by every adapter. */
export function validateExternalStorybookPackageId(value: unknown, label: string): string {
  const id = requiredText(value, label)
  if (!packageIdPattern.test(id)) throw new Error(`${label} must be an exact package name: ${id}`)
  return id
}

/** One normalized executable and overview route law. */
export function validateExternalStorybookRoute(
  value: unknown,
  label: string,
  options: Readonly<{allowEmpty?: boolean}> = {},
): string {
  if (options.allowEmpty === true && value === "") return ""
  const route = requiredText(value, label)
  if (!routePattern.test(route)) {
    throw new Error(`${label} must be a normalized package-local route: ${route}`)
  }
  return route
}

/** One importable ESM export-name law for resolver, loader and protocol child. */
export function validateExternalStorybookExportName(value: unknown, label: string): string {
  const name = requiredText(value, label)
  if (!exportPattern.test(name)) throw new Error(`${label} must be an importable ESM export name: ${name}`)
  return name
}

/** Declaration-level module paths are relative POSIX paths without URL semantics. */
export function validateExternalStorybookModulePath(value: unknown, label: string): string {
  const path = requiredText(value, label)
  if (!modulePathPattern.test(path)) {
    throw new Error(`${label} must be a relative POSIX module path: ${path}`)
  }
  return path
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 ||
    /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be non-empty text without control characters`)
  }
  return value
}
