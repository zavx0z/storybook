import {expect, spyOn, test} from "bun:test"
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {join, resolve} from "node:path"
import Environment from "@zavx0z/storybook-tech-build-environment"
import Build from "@zavx0z/storybook-app-web-build"
import Scheduler from "@zavx0z/storybook-package-build-scheduler"

const toolRoot = resolve(import.meta.dir, "../../../..")

test("без готовой платформы Web отказывает до запуска Bun.build", async () => {
  const build = spyOn(Bun, "build")
  try {
    await expect(Build.buildAssets({root: "/missing", toolRoot, landingEntryPath: "", fallbackEntryPath: "", stagingDirectory: "/missing"} as never))
      .rejects.toThrow("Сборка Web требует готовую платформу")
    expect(build).not.toHaveBeenCalled()
  } finally { build.mockRestore() }
})

test("платформенный worker готовит зависимости; Web компилирует только свои входы и сохраняет платформу", async () => {
  mkdirSync(join(toolRoot, "tmp"), {recursive: true})
  const root = mkdtempSync(join(toolRoot, "tmp/web-boundary-"))
  const assetsRoot = join(root, "assets")
  const entry = join(root, "web.ts")
  const scheduler = new Scheduler({limit: 1})
  writeFileSync(entry, 'export * from "@zavx0z/immersive-dom"\nexport const title = "first"\n')
  try {
    const platform = await scheduler.run({packageId: null, owner: "shared", reason: "explicit-build", generation: null},
      context => Environment.runWorker({root: assetsRoot, toolRoot}, context), new AbortController().signal)
    expect(platform.artifacts.length).toBeGreaterThan(0)
    expect(platform.artifacts.every(artifact => artifact.path.startsWith("kernel/"))).toBeTrue()
    const before = platform.artifacts.map(artifact => [artifact.path, readFileSync(join(assetsRoot, artifact.path))])
    const native = spyOn(Bun, "build")
    const phases: string[] = []
    const input = {root: assetsRoot, toolRoot, landingEntryPath: entry, fallbackEntryPath: entry, packageEntryPath: entry,
      stagingDirectory: join(root, "web-staging"), sharedKernel: platform.identity, kernelArtifacts: platform.artifacts}
    try {
      const first = await Build.buildAssets(input, event => phases.push(event.phase))
      Build.saveReceipt(first)
      expect(native).toHaveBeenCalledTimes(1)
      expect(native.mock.calls.every(([config]) => config.outdir === join(input.stagingDirectory, "host", ".pending"))).toBeTrue()
      const nativeResult = await native.mock.results[0]!.value as Bun.BuildOutput
      expect(Object.keys(nativeResult.metafile!.inputs).some(path => platform.identity.modules.some(module => resolve(path) === module.sourcePath))).toBeFalse()
      expect(first.browserIdentity?.epoch).toBe(platform.identity.epoch)
      writeFileSync(entry, 'export * from "@zavx0z/immersive-dom"\nexport const title = "second"\n')
      const second = await Build.buildAssets(input, event => phases.push(event.phase))
      expect(native).toHaveBeenCalledTimes(2)
      expect(phases).not.toContain("kernel")
      expect(second.browserIdentity?.epoch).toBe(first.browserIdentity?.epoch)
      expect(second.browserIdentity?.hostModuleEpoch).not.toBe(first.browserIdentity?.hostModuleEpoch)
      expect(platform.artifacts.map(artifact => [artifact.path, readFileSync(join(assetsRoot, artifact.path))])).toEqual(before)
      expect(Build.readPublishedReceipt(input)?.browserIdentity).toEqual(first.browserIdentity)
      writeFileSync(join(assetsRoot, platform.artifacts[0]!.path), "damaged")
      await expect(Build.buildAssets(input)).rejects.toThrow("Повреждён артефакт платформы")
      expect(native).toHaveBeenCalledTimes(2)
    } finally { native.mockRestore() }
  } finally {
    scheduler.dispose()
    rmSync(root, {recursive: true, force: true})
  }
}, 600000)
