import {expect} from "bun:test"

/** Проверяет именованный public UI import, сохраняя запрет на собственную копию визуального владельца. */
export function expectNamedUiImport(source: string, component: string): void {
  expect(source).toMatch(new RegExp(`import\\s*\\{[^}]*\\b${component}\\b[^}]*\\}\\s*from\\s*["']@zavx0z/immersive/ui["']`, "u"))
  expect(source).not.toMatch(/from\s*["']@zavx0z\/immersive-ui[^"']*["']/u)
}
