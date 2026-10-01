import {afterEach, expect, setDefaultTimeout, spyOn, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {saveSharedBrowserCandidate} from "../src/receipt"
import {buildSharedBrowserAssets} from "../src/browser-build"
import {sources} from "../src/sources"
import Limits from "@tech/limits"

setDefaultTimeout(2 * Limits.STORYBOOK_SHARED_COMPILE_TIMEOUT_MS)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

test("сборка host для сохранённой платформы сохраняет epochs без повторной компиляции kernel", async () => {
  const nativeBuild = spyOn(Bun, "build")
  try {
    const toolRoot = join(import.meta.dir, "../../../..")
    const root = mkdtempSync(join(tmpdir(), "storybook-shared-determinism-"))
    roots.push(root)
    const common = {
      toolRoot,
      landingEntryPath: sources.browserEntry,
      fallbackEntryPath: sources.browserEntry,
    }

    const first = await buildSharedBrowserAssets({
      ...common,
      root: join(root, "assets"),
      stagingDirectory: join(root, "candidate-one"),
    })
    saveSharedBrowserCandidate(first, true)
    expect(nativeBuild).toHaveBeenCalledTimes(2)
    const phases: string[] = []
    const second = await buildSharedBrowserAssets({
      ...common,
      root: join(root, "assets"),
      stagingDirectory: join(root, "unrelated-candidate-two"),
      sharedKernel: first.browserIdentity!,
    }, event => { phases.push(event.phase) })

    expect(phases).not.toContain("kernel")
    expect(nativeBuild).toHaveBeenCalledTimes(3)

    expect(first.browserIdentity?.epoch).toBe(second.browserIdentity?.epoch)
    expect(first.browserIdentity?.hostModuleEpoch).toBe(second.browserIdentity?.hostModuleEpoch)
    expect(first.browserIdentity?.modules.map(({specifier, url}) => ({specifier, url})))
      .toEqual(second.browserIdentity?.modules.map(({specifier, url}) => ({specifier, url})))
    expect(first.browserIdentity?.sourceFiles).toEqual(second.browserIdentity?.sourceFiles)
    expect(first.browserIdentity?.modules.some(({specifier}) => specifier.startsWith("@zavx0z/ui")))
      .toBeFalse()
  } finally {
    nativeBuild.mockRestore()
  }
})
