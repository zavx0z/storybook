import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createStorybookPackageRevisionBuilder} from "./package-build.ts"
import type {StorybookPackageBuildDescriptor} from "./package-session.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("real Storybook package revision build", () => {
  test("emits a lazy split package entry and canonical dependency graph", async () => {
    const fixture = createFixture()
    const staging = join(fixture.root, ".candidate")
    const build = createStorybookPackageRevisionBuilder({
      browserEntryPath: fixture.browserEntry,
    })
    const result = await build({
      descriptor: fixture.descriptor,
      candidateRevision: "revision-a",
      revisionUrl: "/__storybook/revisions/fixture/revision-a/",
      stagingDirectory: staging,
    })
    expect(result.entryRelativePath).toMatch(/\.js$/u)
    expect(result.dependencyRealpaths).toContain(realpathSync(fixture.runtime))
    expect(result.dependencyRealpaths).toContain(realpathSync(fixture.story))
    expect(result.moduleGraphRevision).toMatch(/^[a-f0-9]{64}$/u)
    expect(await Bun.file(join(staging, result.entryRelativePath)).text()).not.toContain("fixture story marker")
    const chunks = await Array.fromAsync(new Bun.Glob("chunks/*.js").scan({cwd: staging, absolute: true}))
    expect(chunks.length).toBeGreaterThan(0)
    expect((await Promise.all(chunks.map((path) => Bun.file(path).text()))).join("\n"))
      .toContain("fixture story marker")
  })

  test("fails before publish for a missing export", async () => {
    const fixture = createFixture()
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    await expect(build({
      descriptor: {
        ...fixture.descriptor,
        variants: [{
          ...fixture.descriptor.variants[0]!,
          module: {path: fixture.story, export: "missing"},
        }],
      },
      candidateRevision: "revision-b",
      revisionUrl: "/__storybook/revisions/fixture/revision-b/",
      stagingDirectory: join(fixture.root, ".candidate-missing"),
    })).rejects.toThrow()
  })

  test("fails protocol validation without losing build diagnostics", async () => {
    const fixture = createFixture()
    writeFileSync(fixture.runtime, "export const runtime = {protocol: 'storybook-runtime/2', create() {}}\n")
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    await expect(build({
      descriptor: fixture.descriptor,
      candidateRevision: "revision-c",
      revisionUrl: "/__storybook/revisions/fixture/revision-c/",
      stagingDirectory: join(fixture.root, ".candidate-protocol"),
    })).rejects.toThrow("Unsupported Storybook runtime protocol")
  })
})

function createFixture(): Readonly<{
  root: string
  runtime: string
  story: string
  browserEntry: string
  descriptor: StorybookPackageBuildDescriptor
}> {
  const root = mkdtempSync(join(tmpdir(), "storybook-package-build-"))
  roots.push(root)
  const packageRoot = join(root, "package")
  mkdirSync(join(packageRoot, ".storybook"), {recursive: true})
  const manifest = join(packageRoot, ".storybook", "manifest.json")
  const runtime = join(packageRoot, ".storybook", "runtime.ts")
  const story = join(packageRoot, ".storybook", "story.ts")
  const browserEntry = join(root, "browser-entry.ts")
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({name: "@fixture/package", type: "module"}))
  writeFileSync(manifest, "{}\n")
  writeFileSync(runtime, [
    "export const runtime = {",
    "  protocol: 'storybook-runtime/1',",
    "  create() {",
    "    return {mount() {}, unmount() {}, dispose() {}}",
    "  },",
    "}",
    "",
  ].join("\n"))
  writeFileSync(story, "export const story = 'fixture story marker'\n")
  writeFileSync(browserEntry, [
    "export async function startExternalStorybookPackage(input: unknown) {",
    "  globalThis.__fixture = input",
    "}",
    "declare global { var __fixture: unknown }",
    "",
  ].join("\n"))
  return Object.freeze({
    root,
    runtime,
    story,
    browserEntry,
    descriptor: {
      packageId: "@fixture/package",
      packageRoot,
      projectRoot: root,
      manifestPath: manifest,
      declarationDigest: "fixture-declaration",
      runtime: {path: runtime, export: "runtime"},
      variants: [{route: "category/subject/default", module: {path: story, export: "story"}}],
    },
  })
}
