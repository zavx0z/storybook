import {afterEach, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {buildStorybookBrowserPage} from "./browser-build.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

describe("Storybook browser build plugins", () => {
  test("accepts an explicit stateless plugin list", async () => {
    const root = await mkdtemp(join(tmpdir(), "zavx0z-storybook-browser-plugin-"))
    temporaryRoots.push(root)
    const entrypoint = join(root, "entry.ts")
    await Bun.write(entrypoint, `import {value} from "owner:compiled"
document.documentElement.dataset.ownerCompiled = value`)

    const plugin: Bun.BunPlugin = {
      name: "owner-compiled-fixture",
      setup(builder) {
        builder.onResolve({filter: /^owner:compiled$/}, ({path}) => ({
          path,
          namespace: "owner-compiled",
        }))
        builder.onLoad({filter: /.*/, namespace: "owner-compiled"}, () => ({
          contents: `export const value = "ready"`,
          loader: "js",
        }))
      },
    }

    const result = await buildStorybookBrowserPage(entrypoint, {
      minify: false,
      plugins: [plugin],
      sourcemap: "none",
    })

    const source = await result.entry.text()
    expect(source).toContain('var value = "ready"')
    expect(source).toContain("dataset.ownerCompiled = value")
  })

  test("rejects a plugin factory that does not return a list before Bun build", async () => {
    const root = await mkdtemp(join(tmpdir(), "zavx0z-storybook-browser-plugin-"))
    temporaryRoots.push(root)
    const entrypoint = join(root, "entry.ts")
    await Bun.write(entrypoint, "export {}")

    await expect(buildStorybookBrowserPage(entrypoint, {
      minify: false,
      plugins: (() => null) as unknown as () => readonly Bun.BunPlugin[],
      sourcemap: "none",
    })).rejects.toThrow("factory must return a plugin list")
  })
})
