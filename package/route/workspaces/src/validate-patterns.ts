import {isAbsolute} from "node:path"

/** Проверяет непосредственные workspace patterns до передачи в Bun.Glob. */
export function validateWorkspacePatterns(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(pattern => typeof pattern !== "string" || pattern.length === 0)) {
    throw new Error("package.json workspaces must be an array of non-empty patterns")
  }
  for (const pattern of value as string[]) {
    const path = pattern.startsWith("!") ? pattern.slice(1) : pattern
    if (!path || path === "." || path === "./" || isAbsolute(path) || path.includes("\\") || /(^|[/,{])\.\.($|[/,}])/u.test(path)) {
      throw new Error(`Workspace pattern must stay inside the project: ${pattern}`)
    }
  }
  return value as readonly string[]
}
