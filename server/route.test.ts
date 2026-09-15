import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {resolveExternalStorybookDeclarations} from "../discovery/declarations"
import {ExternalStorybookRegistry} from "../catalog/registry"
import {resolveStorybookRoute, storybookRouteRoots} from "./route"

test("общий маршрут находит структурный subject DiagramNode и сохраняет выбранный вариант", async () => {
  const root = resolve(import.meta.dir, "../../webxr-space/nodes/node")
  const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
  await registry.attach(root)
  const snapshot = registry.snapshot()
  expect(storybookRouteRoots(snapshot)).toEqual([{name: "node", path: root}])
  expect(await resolveStorybookRoute("/node/diagram?view=scenarios&variant=Круг&inspector=storybook-scenarios", snapshot)).toEqual({
    packageId: "@nodes/node",
    route: "diagram/scenarios",
    urlPath: "/node/diagram?view=scenarios",
    variant: "Круг",
  })
  expect(await resolveStorybookRoute("/node/absent?view=scenarios", snapshot)).toBeNull()
  expect(await resolveStorybookRoute("/node/diagram?view=scenarios&variant=Круг&variant=Овал", snapshot)).toBeNull()
}, 20000)
