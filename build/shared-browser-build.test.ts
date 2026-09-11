import {afterEach, expect, setDefaultTimeout, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {buildSharedBrowserAssets} from "./shared-browser-build.ts"

setDefaultTimeout(180_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

test("две реальные shared-сборки сохраняют kernel и host epochs при разных staging", async () => {
  const toolRoot = join(import.meta.dir, "..")
  const root = mkdtempSync(join(tmpdir(), "storybook-shared-determinism-"))
  roots.push(root)
  const common = {
    toolRoot,
    landingEntryPath: join(toolRoot, "runtime/browser-entry.ts"),
    fallbackEntryPath: join(toolRoot, "runtime/browser-entry.ts"),
  }

  const first = await buildSharedBrowserAssets({
    ...common,
    root: join(root, "assets"),
    stagingDirectory: join(root, "candidate-one"),
  })
  const second = await buildSharedBrowserAssets({
    ...common,
    root: join(root, "assets"),
    stagingDirectory: join(root, "unrelated-candidate-two"),
  })

  expect(first.browserIdentity?.epoch).toBe(second.browserIdentity?.epoch)
  expect(first.browserIdentity?.hostModuleEpoch).toBe(second.browserIdentity?.hostModuleEpoch)
  expect(first.browserIdentity?.modules.map(({specifier, url}) => ({specifier, url})))
    .toEqual(second.browserIdentity?.modules.map(({specifier, url}) => ({specifier, url})))
  expect(first.browserIdentity?.sourceFiles).toEqual(second.browserIdentity?.sourceFiles)
  expect(first.browserIdentity?.modules.some(({specifier}) => specifier.startsWith("@zavx0z/ui")))
    .toBeFalse()
})
