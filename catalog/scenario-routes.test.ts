import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {discoverStorybookPackages} from "../discovery/packages.ts"
import {createExternalStorybookGraph, resolveExternalStorybookRoute} from "./graph.ts"
import {externalStorybookPackageDescriptors} from "../build/package-descriptor.ts"
import {deriveExternalStorybookPackageTab} from "../runtime/model.ts"
import {createStorybookPackageRevisionGraphSnapshot} from "../sessions/package-revision.ts"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true}))) })

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-scenario-routes-")))
  roots.push(root)
  await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/scenarios"}))
  await mkdir(join(root, "module/spec"), {recursive: true})
  await Bun.write(join(root, "module/index.ts"), "export const module = true")
  const scenarioPath = join(root, "module/spec/scenario.spec.ts")
  await Bun.write(scenarioPath, "throw new Error('Discovery must not execute scenarios')")
  return {root, scenarioPath}
}

test("[SCENARIOS-ROUTE] structural spec creates one view in graph, client model and revision", async () => {
  const {root, scenarioPath} = await fixture()
  const catalog = await discoverStorybookPackages([root])
  const graph = createExternalStorybookGraph(catalog)
  const packageId = "@fixture/scenarios"
  const route = resolveExternalStorybookRoute(graph, packageId, "dir-module/scenarios")
  expect(route.kind).toBe("scenarios")
  expect(route.nodeId).toBe("directory:package:@fixture/scenarios/module")
  expect(route.urlPath).toBe("/scenarios/module?view=scenarios")
  const model = deriveExternalStorybookPackageTab(graph, packageId, route.path)
  expect(model.viewKind).toBe("scenarios")
  expect(model.tabs.map(tab => tab.label)).toEqual(["Обзор", "Сценарии"])
  expect(model.urlPath).toBe(route.urlPath)
  const revision = createStorybookPackageRevisionGraphSnapshot(graph, packageId, "fixture")
  expect(revision.routes.find(item => item.path === route.path)).toMatchObject({nodeId: route.nodeId, kind: "scenarios"})
  const descriptor = externalStorybookPackageDescriptors(catalog, graph)[0]!
  expect(descriptor.scenarioSpecs).toContainEqual({nodeId: route.nodeId, sourcePaths: [scenarioPath]})
  expect(descriptor.watchPaths).toContainEqual({path: scenarioPath, category: "declaration"})
})

test("[SCENARIOS-ABSENT] removing the spec removes only the scenarios view", async () => {
  const {root, scenarioPath} = await fixture()
  await rm(scenarioPath)
  const graph = createExternalStorybookGraph(await discoverStorybookPackages([root]))
  const model = deriveExternalStorybookPackageTab(graph, "@fixture/scenarios", "dir-module")
  expect(model.tabs.map(tab => tab.label)).toEqual(["Обзор"])
  expect(() => resolveExternalStorybookRoute(graph, "@fixture/scenarios", "dir-module/scenarios")).toThrow()
})
