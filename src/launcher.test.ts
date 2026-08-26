import {afterEach, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {join} from "node:path"
import {realpathSync} from "node:fs"
import {tmpdir} from "node:os"
import {
  inspectStorybookPackage,
  launchStorybookPackage,
  resolveStorybookPackage,
  stopStorybookPackage,
} from "./launcher.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

describe("package-name Storybook launcher", () => {
  test("resolves one exact workspace package and rejects aliases or duplicates", async () => {
    const root = await fixtureRoot()
    await writePackage(join(root, "packages", "ui"), "@ui/storybook")
    const identity = await resolveStorybookPackage("@ui/storybook", {
      repositoryRoot: root,
      stateRoot: join(root, "state"),
    })
    expect(identity.name).toBe("@ui/storybook")
    expect(identity.directory).toBe(realpathSync(join(root, "packages", "ui")))
    expect(identity.script).toBe("bun server.ts")
    await expect(resolveStorybookPackage("ui", {repositoryRoot: root})).rejects.toThrow("@scope/storybook")

    await writePackage(join(root, "apps", "ui"), "@ui/storybook")
    await expect(resolveStorybookPackage("@ui/storybook", {repositoryRoot: root})).rejects.toThrow("ambiguous")
  })

  test("rejects a package without the canonical scripts and package-local Bun contract", async () => {
    const root = await fixtureRoot()
    const directory = join(root, "packages", "broken")
    await Bun.write(join(directory, "package.json"), `${JSON.stringify({
      name: "@broken/storybook",
      private: true,
      type: "module",
      scripts: {storybook: "bun server.ts"},
    }, null, 2)}\n`)
    await expect(resolveStorybookPackage("@broken/storybook", {repositoryRoot: root}))
      .rejects.toThrow("scripts.build")
  })

  test("starts on an OS-allocated port and stops only the recorded child", async () => {
    const root = await fixtureRoot()
    const packageDirectory = join(root, "packages", "fixture")
    await writePackage(packageDirectory, "@fixture/storybook", true)
    const identity = await resolveStorybookPackage("@fixture/storybook", {
      repositoryRoot: root,
      stateRoot: join(root, "state"),
    })
    const launched = await launchStorybookPackage(identity, {waitMs: 8_000})
    try {
      expect(launched.outcome).toBe("started")
      expect(launched.runtime.packageName).toBe("@fixture/storybook")
      expect(new URL(launched.runtime.origin).port).not.toBe("")
      expect(Number(new URL(launched.runtime.origin).port)).toBeGreaterThan(0)
      expect(await fetch(new URL(launched.runtime.healthPath, launched.runtime.origin)).then(({status}) => status)).toBe(200)

      const running = await inspectStorybookPackage(identity)
      expect(running.status).toBe("running")
      expect(running.healthy).toBeTrue()

      const stopped = await stopStorybookPackage(identity)
      expect(stopped.status).toBe("stopped")
      expect((await inspectStorybookPackage(identity)).status).toBe("stopped")
    } finally {
      if (launched.runtime.pid > 0) {
        try {
          process.kill(launched.runtime.pid, "SIGTERM")
        } catch {
          // The exact fixture child already stopped.
        }
      }
      launched.child?.kill("SIGTERM")
    }
  })
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "storybook-launcher-test-"))
  temporaryRoots.push(root)
  await Bun.write(join(root, "package.json"), `${JSON.stringify({private: true, workspaces: ["packages/*", "apps/*"]}, null, 2)}\n`)
  return root
}

async function writePackage(directory: string, name: string, runnable = false): Promise<void> {
  await Bun.write(join(directory, "package.json"), `${JSON.stringify({
    name,
    private: true,
    type: "module",
    scripts: {
      storybook: "bun server.ts",
      build: "bun build.ts",
      test: "bun test .",
      typecheck: "tsc --noEmit",
      check: "bun run typecheck && bun run test && bun run build",
    },
  }, null, 2)}\n`)
  await Bun.write(join(directory, "bunfig.toml"), `[install]
peer = false

[loader]
".wgsl" = "text"
`)
  if (!runnable) return
  const sourceRoot = import.meta.dir
  await Bun.write(join(directory, "body.html"), "<main id=\"fixture\">Fixture</main>\n")
  await Bun.write(join(directory, "style.css"), "html,body { margin: 0; }\n")
  await Bun.write(join(directory, "entry.ts"), "document.documentElement.dataset.fixtureStorybook = \"ready\"\n")
  await Bun.write(join(directory, "font.ttf"), new Uint8Array([0, 1, 2, 3]))
  await Bun.write(join(directory, "server.ts"), `import {join} from "node:path"
import {defineStorybookApp} from ${JSON.stringify(join(sourceRoot, "app.ts"))}
import {defineStorybookRouteTree} from ${JSON.stringify(join(sourceRoot, "route-tree.ts"))}
import {startStorybookPackageServer} from ${JSON.stringify(join(sourceRoot, "server.ts"))}

startStorybookPackageServer({
  app: defineStorybookApp({
    id: "fixture",
    title: "Fixture Storybook",
    basePath: "",
    home: {path: "/", label: "Главная", ariaLabel: "На главную Fixture Storybook"},
    footer: {
      lead: "Создано для",
      owner: {label: "MetaFor", href: "https://github.com/zavx0z/metafor"},
      detail: "launcher fixture",
    },
    head: {meta: [{kind: "public-path", name: "engine-default-font", path: "/font.ttf"}]},
    pages: [{
      id: "fixture",
      title: "Fixture Storybook",
      mountPath: "/",
      entrypoint: join(import.meta.dir, "entry.ts"),
      stylePath: join(import.meta.dir, "style.css"),
      body: {kind: "html", bodyHtmlPath: join(import.meta.dir, "body.html")},
      capability: "dom",
      readiness: {dataset: "fixtureStorybook", value: "ready"},
      routeTree: defineStorybookRouteTree({leaves: [] as const}),
    }],
  }),
  staticFiles: [{publicPath: "/font.ttf", sourcePath: join(import.meta.dir, "font.ttf")}],
})
`)
}
