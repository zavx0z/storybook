import {afterEach, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {
  createStorybookPackage,
  STORYBOOK_PACKAGE_TEMPLATE_PATHS,
  validateStorybookPackageScaffold,
} from "./scaffold.ts"

const temporaryRoots: string[] = []
const packageRoot = join(import.meta.dir, "..")

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

describe("create-storybook canonical package scaffold", () => {
  test("creates the exact package, Workbench, stories, fixture and lab-state composition", async () => {
    const parent = await temporaryRoot()
    const target = join(parent, "quantum-storybook")
    const created = await createStorybookPackage({
      packageName: "@quantum/storybook",
      directory: target,
    })
    expect(created.packageName).toBe("@quantum/storybook")
    expect(created.appId).toBe("quantum")
    expect(created.title).toBe("Quantum Storybook")
    expect(created.files).toEqual(STORYBOOK_PACKAGE_TEMPLATE_PATHS)

    const manifest = await Bun.file(join(target, "package.json")).json() as Record<string, unknown>
    expect(manifest.name).toBe("@quantum/storybook")
    expect(manifest.private).toBeTrue()
    expect(manifest.scripts).toEqual({
      storybook: "bun server.ts",
      build: "bun build.ts",
      test: "bun test .",
      typecheck: "tsc --noEmit --pretty false",
      check: "bun run typecheck && bun run test && bun run build",
    })

    const server = await Bun.file(join(target, "server.ts")).text()
    expect(server).toContain('from "@zavx0z/storybook/server"')
    expect(server).toContain("startStorybookPackageServer({")
    expect(server).not.toContain("port:")
    expect(server).not.toMatch(/_STORYBOOK_PORT/u)

    const app = await Bun.file(join(target, "app.ts")).text()
    expect(app).toContain('id: "quantum"')
    expect(app).toContain("pages: [createStorybookPage()]")
    const page = await Bun.file(join(target, "page/page.ts")).text()
    expect(page).toContain('dataset: "quantumStorybook"')
    expect(page).toContain('canvasId: "quantum-storybook-canvas"')
    const stories = await Bun.file(join(target, "page/stories.ts")).text()
    expect(stories).toContain("loadPresentation")
    expect(stories).toContain("return node.path as PresentationRoute")
    expect(stories).not.toContain("routeTree.leaves.find")
    const entry = await Bun.file(join(target, "page/entry.ts")).text()
    expect(entry).toContain("source: state.source")
    expect(entry).toContain("category: state.panelCategory")
    expect(entry).toContain("onCategoryChange(category)")
    expect(entry).toContain("StorybookHtml = source.html")
    expect(entry).toContain("StorybookCss = source.css")
    expect(entry).toContain("StorybookTypescript = source.typescript")
    const labState = await Bun.file(join(target, "page/state/lab-state.ts")).text()
    expect(labState).toContain('StorybookStoryPanelCategory = "source"')
    expect(labState).toContain("get source(): StorybookStorySource")
    expect(await Bun.file(join(target, "page/style.css")).text()).not.toContain("background")
    for (const path of [
      "page/entry.ts",
      "page/page.ts",
      "page/stories.ts",
      "page/preview.ts",
      "page/fixtures/example.ts",
      "page/state/lab-state.ts",
      "page/stories/example.ts",
      "page/stories/overview.ts",
    ]) expect(await Bun.file(join(target, path)).exists(), path).toBeTrue()

    expect((await validateStorybookPackageScaffold(target, "@quantum/storybook")).files)
      .toEqual(STORYBOOK_PACKAGE_TEMPLATE_PATHS)

    const builds = await Promise.all([
      Bun.build({entrypoints: [join(target, "page/entry.ts")], target: "browser", packages: "external"}),
      Bun.build({entrypoints: [join(target, "server.ts")], target: "bun", packages: "external"}),
      Bun.build({entrypoints: [join(target, "build.ts")], target: "bun", packages: "external"}),
    ])
    for (const build of builds) expect(build.success, build.logs.join("\n")).toBeTrue()
  })

  test("refuses invalid names, existing targets and partial package mutation", async () => {
    const parent = await temporaryRoot()
    await expect(createStorybookPackage({packageName: "quantum", directory: join(parent, "invalid")}))
      .rejects.toThrow("@scope/storybook")
    await expect(createStorybookPackage({packageName: "@bad.scope/storybook", directory: join(parent, "invalid-scope")}))
      .rejects.toThrow("kebab-case scope")

    const target = join(parent, "existing")
    await Bun.write(join(target, "owner.txt"), "preserve\n")
    await expect(createStorybookPackage({packageName: "@quantum/storybook", directory: target}))
      .rejects.toThrow("refuses an existing target")
    expect(await Bun.file(join(target, "owner.txt")).text()).toBe("preserve\n")
  })

  test("exposes the same atomic scaffold through the create-storybook executable", async () => {
    const parent = await temporaryRoot()
    const target = join(parent, "created")
    const child = Bun.spawn([
      "bun",
      join(packageRoot, "scripts", "create-storybook.ts"),
      "@created/storybook",
      target,
    ], {
      cwd: parent,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout).packageName).toBe("@created/storybook")
    expect((await validateStorybookPackageScaffold(target)).packageName).toBe("@created/storybook")
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "create-storybook-test-"))
  temporaryRoots.push(root)
  return root
}
