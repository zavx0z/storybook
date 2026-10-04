import Environment from "@storybook-tech-build/environment"
import {afterEach, expect, setDefaultTimeout, spyOn, test} from "bun:test"
import {mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {randomUUID} from "node:crypto"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {saveSharedBrowserCandidate} from "../src/receipt"
import {buildSharedBrowserAssets} from "../src/browser-build"
import {sources} from "../src/sources"

setDefaultTimeout(2 * 480_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

test("сборка host сохраняет платформу и адресует Web по готовым файлам", async () => {
  const nativeBuild = spyOn(Bun, "build")
  const note = join(import.meta.dir, "../../../..", `.build-edit-${randomUUID()}.md`)
  writeFileSync(note, "before")
  try {
    const toolRoot = join(import.meta.dir, "../../../..")
    const root = mkdtempSync(join(tmpdir(), "storybook-shared-determinism-"))
    roots.push(root)
    const common = {
      toolRoot,
      landingEntryPath: sources.browserEntry,
      fallbackEntryPath: sources.browserEntry,
    }

    const platform = await Environment.build({root: join(root, "assets"), toolRoot, stagingDirectory: join(root, "platform")})
    expect(nativeBuild).toHaveBeenCalledTimes(1)
    const first = await buildSharedBrowserAssets({
      sharedKernel: platform.identity, kernelArtifacts: platform.artifacts,
      ...common,
      root: join(root, "assets"),
      stagingDirectory: join(root, "candidate-one"),
    }, event => {
      if (event.phase === "host" && event.state === "started") writeFileSync(note, "edited during compilation")
    })
    saveSharedBrowserCandidate(first)
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
      kernelArtifacts: platform.artifacts,
    }, event => { phases.push(event.phase) })

    expect(phases).not.toContain("kernel")
    expect(phases).not.toContain("fingerprint")
    expect(phases).not.toContain("cache")
    expect(nativeBuild).toHaveBeenCalledTimes(3)
    expect(nativeBuild.mock.calls.filter(([config]) => config.outdir?.includes("kernel"))).toHaveLength(1)

    expect(first.browserIdentity?.epoch).toBe(second.browserIdentity?.epoch)
    const webArtifacts = (assets: typeof first) => assets.artifactDigests!.filter(artifact =>
      artifact.path.startsWith("host/") || artifact.path.startsWith("styles/"))
      .map(({path, digest}) => ({path, digest})).sort((a, b) => a.path.localeCompare(b.path))
    expect(first.browserIdentity?.hostModuleEpoch === second.browserIdentity?.hostModuleEpoch,
      "Одинаковые выпущенные Web-файлы имеют одну версию; разные файлы получают разные версии")
      .toBe(JSON.stringify(webArtifacts(first)) === JSON.stringify(webArtifacts(second)))
    expect(first.browserIdentity?.modules.map(({specifier, url}) => ({specifier, url})))
      .toEqual(second.browserIdentity?.modules.map(({specifier, url}) => ({specifier, url})))
    expect(first.browserIdentity?.modules.some(({specifier}) => specifier.startsWith("@immersive-ui/component")))
      .toBeFalse()
  } finally {
    nativeBuild.mockRestore()
    rmSync(note, {force: true})
  }
})
