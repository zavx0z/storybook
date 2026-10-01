import {expect, test} from "bun:test"
import {readFileSync} from "node:fs"
import {dirname, resolve} from "node:path"

test("технические владельцы не импортируют предметы или приложение Storybook", () => {
  const root = resolve(import.meta.dir, "../../..")
  const manifests = new Map<string, Readonly<{
    name: string
    dependencies?: Readonly<Record<string, string>>
    devDependencies?: Readonly<Record<string, string>>
  }>>()
  for (const path of new Bun.Glob("**/package.json").scanSync({cwd: root, absolute: true})) {
    if (path.includes("/node_modules/")) continue
    manifests.set(dirname(path), JSON.parse(readFileSync(path, "utf8")))
  }
  const technicalNames = new Set([...manifests.values()].map(manifest => manifest.name))
  const imports: string[] = []
  for (const path of new Bun.Glob("**/*.ts").scanSync({cwd: root, absolute: true})) {
    if (/\/(?:spec|test)\//u.test(path)) continue
    const source = readFileSync(path, "utf8")
    let directory = dirname(path)
    while (!manifests.has(directory) && directory !== root) directory = dirname(directory)
    const owner = manifests.get(directory)
    for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/gu)) {
      const target = match[1]!
      if (target.startsWith(".")) {
        const resolved = resolve(path, "..", target)
        if (!resolved.startsWith(`${directory}/`) && resolved !== directory) imports.push(`${path}: ${target}`)
      } else if (!target.startsWith("node:")) {
        const name = target.startsWith("@") ? target.split("/").slice(0, 2).join("/") : target.split("/")[0]!
        const version = owner?.dependencies?.[name] ?? owner?.devDependencies?.[name]
        if (owner === undefined || name !== owner.name &&
          (version === undefined || version.startsWith("workspace:") && !technicalNames.has(name))) {
          imports.push(`${path}: ${target}`)
        }
      }
    }
  }
  expect(imports).toEqual([])
})
