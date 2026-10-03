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
    const hostFiles = first.artifactDigests!.filter(artifact => artifact.path.startsWith("host/"))
    expect(hostFiles.filter(artifact => artifact.path.endsWith(".js")), "Web выпускает один загрузчик и один bundle интерфейса")
      .toHaveLength(2)
    expect(hostFiles.filter(artifact => artifact.path.endsWith(".map"))).toHaveLength(2)
    expect(hostFiles.some(artifact => artifact.path.includes("/chunks/")), "Mermaid и редактор не выпускаются отдельными чанками Web")
      .toBeFalse()
    expect(first.landingEntry).toBe(first.bootstrapEntry!)
    expect(first.fallbackEntry).toBe(first.bootstrapEntry!)
    expect(first.browserIdentity!.packageEntryUrl).not.toBe(`/__storybook/shared/${first.bootstrapEntry}`)
    expect(nativeBuild).toHaveBeenCalledTimes(2)
    expect(nativeBuild.mock.calls.filter(([config]) => config.outdir?.includes("kernel"))).toHaveLength(1)
    const phases: string[] = []
    const second = await buildSharedBrowserAssets({
      ...common,
      root: join(root, "assets"),
      stagingDirectory: join(root, "unrelated-candidate-two"),
      sharedKernel: first.browserIdentity!,
    }, event => { phases.push(event.phase) })

    expect(phases).not.toContain("kernel")
    expect(nativeBuild).toHaveBeenCalledTimes(3)
    expect(nativeBuild.mock.calls.filter(([config]) => config.outdir?.includes("kernel"))).toHaveLength(1)

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
