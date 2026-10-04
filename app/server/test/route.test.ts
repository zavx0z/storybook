import PackageMetadataCollectOwner from "@zavx0z/storybook-package-metadata-collect"
import AppServerCatalogOwner, {type StorybookAppServerCatalog as AppServerCatalogContract} from "@zavx0z/storybook-app-server-catalog"
const discoverStorybookPackages = PackageMetadataCollectOwner
const ExternalStorybookRegistry = AppServerCatalogOwner
type ExternalStorybookRegistry = AppServerCatalogContract.Output
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {resolveStorybookRoute, storybookRouteRoots} from "../src/route"

test("общий маршрут находит вложенный пакет Diagram и сохраняет выбранный вариант сценария", async () => {
  const root = resolve(import.meta.dir, "../../../../immersive/nodes/node")
  const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
  await registry.attach(root)
  const snapshot = registry.snapshot()
  expect(storybookRouteRoots(snapshot)).toEqual([{name: "immersive-nodes-node", path: root}])
  expect(await resolveStorybookRoute("/immersive-nodes-node/diagram?view=scenarios&variant=Круг&inspector=storybook-scenarios", snapshot)).toEqual({
    packageId: "@zavx0z/immersive-nodes-node-diagram",
    route: "scenarios",
    urlPath: "/immersive-nodes-node/diagram?view=scenarios",
    variant: "Круг",
  })
  expect(await resolveStorybookRoute("/immersive-nodes-node/absent?view=scenarios", snapshot)).toBeNull()
  expect(await resolveStorybookRoute("/immersive-nodes-node/diagram?view=scenarios&variant=Круг&variant=Овал", snapshot)).toBeNull()
}, 20000)
