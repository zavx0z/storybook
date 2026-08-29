import {afterEach, describe, expect, test} from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "./declarations.ts"
import {
  EXTERNAL_STORYBOOK_CATALOG_SCHEMA_URL,
  EXTERNAL_STORYBOOK_MANIFEST_SCHEMA_URL,
  initExternalStorybookDeclaration,
} from "./init.ts"
import {
  validateStorybookRuntimeAdapter,
  validateStorybookRuntimeSession,
} from "./runtime-protocol.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("external Storybook declaration init", () => {
  test("creates only a package manifest and valid documentation catalog by default", async () => {
    const root = packageRoot("button", "@fixture/button")
    const packageJson = readFileSync(join(root, "package.json"), "utf8")
    const result = await initExternalStorybookDeclaration({
      root,
      kind: "package",
      label: "Fixture Button",
    })

    expect(readdirSync(result.directory).sort()).toEqual(["catalog.json", "manifest.json"])
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(packageJson)
    const manifest = json(result.manifestPath)
    expect(manifest).toEqual({
      $schema: EXTERNAL_STORYBOOK_MANIFEST_SCHEMA_URL,
      schemaVersion: 1,
      kind: "package",
      id: "@fixture/button",
      label: "Fixture Button",
      packageJson: "../package.json",
      readme: "../README.md",
      catalog: "./catalog.json",
    })
    expect(json(result.catalogPath!)).toEqual({
      $schema: EXTERNAL_STORYBOOK_CATALOG_SCHEMA_URL,
      schemaVersion: 1,
      categories: [{
        id: "package",
        label: "Package",
        subjects: [{
          id: "overview",
          kind: "documentation",
          label: "Fixture Button",
          apiName: "@fixture/button",
          variants: [],
        }],
      }],
    })
    const resolved = await resolveExternalStorybookDeclarations([root])
    expect(resolved.rootIds).toEqual(["package:@fixture/button"])
    for (const forbidden of ["bunfig.toml", "build.ts", "server.ts", "package.json"]) {
      expect(existsSync(join(result.directory, forbidden))).toBeFalse()
    }
  })

  test("adds a plain structural runtime and stories directory only when requested", async () => {
    const root = packageRoot("runtime", "@fixture/runtime")
    const result = await initExternalStorybookDeclaration({
      root,
      kind: "package",
      executable: true,
      stories: true,
    })

    expect(readdirSync(result.directory).sort()).toEqual([
      "catalog.json",
      "manifest.json",
      "runtime.ts",
      "stories",
    ])
    expect(readdirSync(result.storiesPath!)).toEqual([])
    const runtimeSource = readFileSync(result.runtimePath!, "utf8")
    expect(runtimeSource).toContain('protocol: "storybook-runtime/1"')
    expect(runtimeSource).not.toContain("@zavx0z/storybook")
    expect(runtimeSource).not.toContain("import ")
    const module = await import(`${result.runtimePath}?test=${crypto.randomUUID()}`)
    const runtime = validateStorybookRuntimeAdapter(module.runtime)
    expect(validateStorybookRuntimeSession(await runtime.create({} as never))).toBeDefined()
    expect(json(result.manifestPath).runtime).toEqual({
      module: "./runtime.ts",
      export: "runtime",
    })
  })

  test("discovers direct packages and projects in deterministic declaration order", async () => {
    const workspace = fixtureRoot("workspace")
    mkdirSync(join(workspace, "projects"))
    for (const projectName of ["zeta", "alpha"]) {
      const project = join(workspace, "projects", projectName)
      mkdirSync(join(project, "packages"), {recursive: true})
      writeFileSync(join(project, "README.md"), `# ${projectName}\n`)
      for (const packageName of ["second", "first"]) {
        const owner = join(project, "packages", packageName)
        mkdirSync(owner)
        writePackage(owner, `@${projectName}/${packageName}`)
        await initExternalStorybookDeclaration({root: owner, kind: "package"})
      }
      await initExternalStorybookDeclaration({root: project, kind: "project"})
      expect(json(join(project, ".storybook", "manifest.json")).packages).toEqual([
        {declaration: "../packages/first/.storybook/manifest.json"},
        {declaration: "../packages/second/.storybook/manifest.json"},
      ])
    }

    const result = await initExternalStorybookDeclaration({
      root: workspace,
      kind: "workspace",
      label: "Fixture Workspace",
    })
    expect(json(result.manifestPath).projects).toEqual([
      {declaration: "../projects/alpha/.storybook/manifest.json"},
      {declaration: "../projects/zeta/.storybook/manifest.json"},
    ])
    const resolved = await resolveExternalStorybookDeclarations([workspace])
    expect(resolved.declarations.filter(({kind}) => kind === "project")).toHaveLength(2)
    expect(resolved.declarations.filter(({kind}) => kind === "package")).toHaveLength(4)
  })

  test("fails before mutation when composition has no direct declarations", async () => {
    for (const kind of ["project", "workspace"] as const) {
      const root = fixtureRoot(kind)
      await expect(initExternalStorybookDeclaration({root, kind}))
        .rejects.toThrow("found no direct")
      expect(existsSync(join(root, ".storybook"))).toBeFalse()
      expect(readdirSync(root).some((name) => name.startsWith(".storybook-init-"))).toBeFalse()
    }
  })

  test("refuses existing declarations and invalid package identity without partial output", async () => {
    const existing = packageRoot("existing", "@fixture/existing")
    mkdirSync(join(existing, ".storybook"))
    writeFileSync(join(existing, ".storybook", "owner.txt"), "preserve\n")
    await expect(initExternalStorybookDeclaration({root: existing, kind: "package"}))
      .rejects.toThrow("refuses an existing declaration directory")
    expect(readFileSync(join(existing, ".storybook", "owner.txt"), "utf8")).toBe("preserve\n")

    const invalid = packageRoot("invalid", "Invalid Package")
    await expect(initExternalStorybookDeclaration({root: invalid, kind: "package"}))
      .rejects.toThrow("exact package name")
    expect(existsSync(join(invalid, ".storybook"))).toBeFalse()
  })

  test("rejects package-only options for project and workspace before mutation", async () => {
    for (const kind of ["project", "workspace"] as const) {
      const root = fixtureRoot(`options-${kind}`)
      await expect(initExternalStorybookDeclaration({root, kind, executable: true}))
        .rejects.toThrow("cannot create runtime or stories")
      expect(existsSync(join(root, ".storybook"))).toBeFalse()
    }
  })
})

function fixtureRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `external-storybook-init-${name}-`))
  roots.push(root)
  return root
}

function packageRoot(name: string, packageName: string): string {
  const root = fixtureRoot(name)
  writePackage(root, packageName)
  return root
}

function writePackage(root: string, name: string): void {
  writeFileSync(join(root, "package.json"), `${JSON.stringify({name}, null, 2)}\n`)
  writeFileSync(join(root, "README.md"), `# ${name}\n`)
}

function json(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"))
}
