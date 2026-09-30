import {expect, test} from "bun:test"
import {readFileSync} from "node:fs"
import {resolve} from "node:path"

test("технические владельцы не импортируют предметы или приложение Storybook", () => {
  const root = resolve(import.meta.dir, "../../..")
  const imports: string[] = []
  for (const path of new Bun.Glob("**/*.ts").scanSync({cwd: root, absolute: true})) {
    if (/\/(?:spec|test)\//u.test(path)) continue
    const source = readFileSync(path, "utf8")
    for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/gu)) {
      const target = match[1]!
      if (target.startsWith(".")) {
        const owner = resolve(path, "..", target)
        if (!owner.startsWith(`${root}/`)) imports.push(`${path}: ${target}`)
      } else if (!target.startsWith("node:") && !/^@(?:process|build|tech)\//u.test(target)) imports.push(`${path}: ${target}`)
    }
  }
  expect(imports).toEqual([])
})
