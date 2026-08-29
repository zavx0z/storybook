import {afterEach, describe, expect, test} from "bun:test"
import {mkdir, mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {resolveExternalStorybookDeclarations} from "./declarations.ts"
import {createExternalStorybookGraph} from "./graph.ts"
import {
  compareRouteBaseline,
  scanStorybookConsumerBoundaries,
  type StorybookRouteBaseline,
} from "./consumer-boundary.ts"

const roots: string[] = []
const graphFixtureRoot = join(import.meta.dir, "fixtures", "valid")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})))
})

describe("external Storybook consumer boundary", () => {
  test("accepts declaration-only owner roots and excludes generated/dependency trees", async () => {
    const root = await temporaryRoot("clean")
    await writeJson(join(root, "package.json"), {
      name: "@fixture/clean",
      exports: {".": "./src/index.ts"},
    })
    await Bun.write(join(root, "src", "index.ts"), "export const clean = true\n")
    await Bun.write(join(root, "src", "example.ts"), String.raw`export const example = ` + "`" + String.raw`
import type {Example} from "@zavx0z/storybook/app"
` + "`\n")
    await Bun.write(join(root, ".storybook", "runtime.ts"), "export const runtime = {}\n")
    await Bun.write(join(root, ".storybook", "stories", "button.ts"), "export const story = {}\n")
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

describe("external Storybook route baseline", () => {
  test("proves exact leaf/overview parity through a documented package remap", async () => {
    const graph = await fixtureGraph()
    const baseline: StorybookRouteBaseline = {
      packageId: "@legacy/components",
      leaves: [
        "components/button/basic/contained",
        "components/button/outlined",
      ],
      overviews: [
        "",
        "foundation",
        "foundation/event-target",
        "components",
        "components/button",
      ],
      unknownRoutesFailClosed: true,
      overviewFallback: false,
    }
    const result = compareRouteBaseline(baseline, graph, [{
      kind: "package",
      fromPackageId: "@legacy/components",
      toPackageId: "@fixture/components",
      reason: "Private package removal preserves the owner package routes",
    }])

    expect(result.ok).toBeTrue()
    expect(result.missingLeaves).toEqual([])
    expect(result.unexpectedOverviews).toEqual([])
    expect(result.leafOrderMatches).toBeTrue()
    expect(result.overviewOrderMatches).toBeTrue()
    expect(result.unknownRoutesFailClosed).toBeTrue()
    expect(result.overviewFallback).toBeFalse()
  })

  test("supports documented exact route remaps and reports parity gaps", async () => {
    const graph = await fixtureGraph()
    const baseline: StorybookRouteBaseline = {
      packageId: "@legacy/components",
      leaves: ["legacy/contained"],
      overviews: [""],
      unknownRoutesFailClosed: true,
      overviewFallback: false,
    }
    const result = compareRouteBaseline(baseline, graph, [
      {
        kind: "package",
        fromPackageId: "@legacy/components",
        toPackageId: "@fixture/components",
        reason: "Package owner remap",
      },
      {
        kind: "route",
        fromPackageId: "@legacy/components",
        fromPath: "legacy/contained",
        toPackageId: "@fixture/components",
        toPath: "components/button/basic/contained",
        reason: "Documented legacy deep-link override",
      },
    ])

    expect(result.ok).toBeFalse()
    expect(result.missingLeaves).toEqual([])
    expect(result.unexpectedLeaves.map(({path}) => path)).toEqual(["components/button/outlined"])
    expect(result.unexpectedOverviews.map(({path}) => path)).toEqual([
      "foundation",
      "foundation/event-target",
      "components",
      "components/button",
    ])
  })

  test("fails closed for undocumented remaps, unknown targets and fallback baselines", async () => {
    const graph = await fixtureGraph()
    const baseline: StorybookRouteBaseline = {
      packageId: "@legacy/components",
      leaves: [],
      overviews: [""],
      unknownRoutesFailClosed: true,
      overviewFallback: false,
    }
    expect(() => compareRouteBaseline(baseline, graph, [{
      kind: "package",
      fromPackageId: "@legacy/components",
      toPackageId: "@fixture/components",
      reason: "",
    }])).toThrow("document its reason")
    expect(() => compareRouteBaseline(baseline, graph, [{
      kind: "package",
      fromPackageId: "@legacy/components",
      toPackageId: "@fixture/missing",
      reason: "Missing target",
    }])).toThrow("Unknown Storybook route-remap target package")
    expect(() => compareRouteBaseline({
      ...baseline,
      overviewFallback: true,
    } as unknown as StorybookRouteBaseline, graph)).toThrow("no overview fallback")
  })
})

async function fixtureGraph() {
  return createExternalStorybookGraph(await resolveExternalStorybookDeclarations([
    graphFixtureRoot,
    join(graphFixtureRoot, "standalone"),
  ]))
}

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `storybook-consumer-${label}-`))
  roots.push(root)
  return root
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), {recursive: true})
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)
}
