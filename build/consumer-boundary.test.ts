import {afterEach, describe, expect, test} from "bun:test"
import {mkdir, mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {scanStorybookConsumerBoundaries} from "./consumer-boundary.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})))
})

describe("external Storybook consumer boundary", () => {
  test("accepts ordinary owner roots and excludes generated/dependency trees", async () => {
    const root = await temporaryRoot("clean")
    await writeJson(join(root, "package.json"), {
      name: "@fixture/clean",
      exports: {".": "./src/index.ts"},
    })
    await Bun.write(join(root, "src", "index.ts"), "export const clean = true\n")
    await Bun.write(join(root, "src", "example.ts"), String.raw`export const example = ` + "`" + String.raw`
import type {Example} from "@zavx0z/storybook/app"
` + "`\n")
    await Bun.write(join(root, "templates", "package.json"), String.raw`{
      "name": {{packageNameJson}},
      "scripts": {"build": {{buildScriptJson}}}
    }`)
    for (const ignored of ["node_modules", ".git", "dist"]) {
      await writeJson(join(root, ignored, "package.json"), {
        name: "@ignored/storybook",
        dependencies: {"@zavx0z/storybook": "forbidden"},
      })
    }

    expect(scanStorybookConsumerBoundaries([root])).toEqual([])
  })

  test("reports old package, dependency, import, wrapper, lifecycle and story exports deterministically", async () => {
    const root = await temporaryRoot("old")
    await writeJson(join(root, "package.json"), {
      name: "@fixture/workspace",
      devDependencies: {"@zavx0z/storybook": "link:@zavx0z/storybook"},
      scripts: {storybook: "bun packages/storybook/server.ts"},
      exports: {"./stories": "./stories/index.ts"},
    })
    await writeJson(join(root, "packages", "storybook", "package.json"), {
      name: "@fixture/storybook",
      dependencies: {"@zavx0z/storybook": "link:@zavx0z/storybook"},
    })
    await Bun.write(join(root, "packages", "storybook", "server.ts"), "export {}\n")
    await Bun.write(join(root, "packages", "storybook", "scripts", "build.ts"), "export {}\n")
    await Bun.write(join(root, "packages", "storybook", "bootstrap.ts"), "export {}\n")
    await Bun.write(join(root, "scripts", "storybook.sh"), "#!/bin/sh\nexit 0\n")
    await Bun.write(join(root, "src", "consumer.ts"), [
      'import "@zavx0z/storybook"',
      'import type {StorybookAppManifest} from "@zavx0z/storybook/app"',
      'const load = () => import("@zavx0z/storybook/workbench")',
      'expect(source).toContain(`from "@zavx0z/storybook/catalog"`)',
    ].join("\n"))

    const first = scanStorybookConsumerBoundaries([root])
    const second = scanStorybookConsumerBoundaries([root])
    expect(first).toEqual(second)
    expect(first.map(({kind}) => kind)).toEqual([
      "production-story-export",
      "storybook-dependency",
      "storybook-lifecycle",
      "storybook-wrapper",
      "storybook-dependency",
      "storybook-package",
      "storybook-wrapper",
      "storybook-wrapper",
      "storybook-wrapper",
      "storybook-import",
      "storybook-import",
      "storybook-import",
    ])
    expect(first.map(({path}) => path)).toEqual([
      "package.json",
      "package.json",
      "package.json",
      "packages/storybook/bootstrap.ts",
      "packages/storybook/package.json",
      "packages/storybook/package.json",
      "packages/storybook/scripts/build.ts",
      "packages/storybook/server.ts",
      "scripts/storybook.sh",
      "src/consumer.ts",
      "src/consumer.ts",
      "src/consumer.ts",
    ])
    expect(first.every((violation) => violation.root === first[0]!.root)).toBeTrue()
    expect(Object.isFrozen(first)).toBeTrue()
  })

  test("never widens an explicit connected-root scan", async () => {
    const connected = await temporaryRoot("connected")
    const sibling = await temporaryRoot("sibling")
    await writeJson(join(connected, "package.json"), {name: "@fixture/connected"})
    await writeJson(join(sibling, "package.json"), {
      name: "@fixture/storybook",
      dependencies: {"@zavx0z/storybook": "forbidden"},
    })

    expect(scanStorybookConsumerBoundaries([connected])).toEqual([])
  })

  test("rejects production/archive and unbounded roots", async () => {
    const root = await temporaryRoot("boundary")
    const production = join(root, "production")
    await writeJson(join(root, "package.json"), {name: "@fixture/root"})
    await writeJson(join(production, "package.json"), {name: "@fixture/production"})

    expect(() => scanStorybookConsumerBoundaries([production])).toThrow("excluded production/archive")
    expect(() => scanStorybookConsumerBoundaries([])).toThrow("explicit connected roots")
    expect(() => scanStorybookConsumerBoundaries([dirname(root)])).toThrow("own package.json")
  })
})

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `storybook-consumer-${label}-`))
  roots.push(root)
  return root
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), {recursive: true})
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)
}
