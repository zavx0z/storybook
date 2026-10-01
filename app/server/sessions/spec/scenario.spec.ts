/** Session manager готовит выбранный пакет из структурного каталога. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Sessions from "@app-server/sessions"
import Registry from "@app-server/catalog"
import discoverStorybookPackages from "@repo/discovery"

const fixtureRoot = join(import.meta.dir, "../../../../repo/discovery/fixtures/valid")

describe.each([
  {name: "Вложенный компонент", props: {packageId: "@fixture/components"}},
  {name: "Вложенная документация", props: {packageId: "@fixture/docs"}},
])("$name", async ({props}) => {
  const registry = new Registry(discoverStorybookPackages)
  await registry.attach(fixtureRoot)
  const directory = mkdtempSync(join(tmpdir(), "storybook-session-scenario-"))
  const manager = new Sessions({
    artifactRoot: join(directory, "artifacts"),
    buildRevision: async ({stagingDirectory}) => {
      mkdirSync(stagingDirectory, {recursive: true})
      writeFileSync(join(stagingDirectory, "entry.js"), "export {}\n")
      return {moduleGraphRevision: "fixture-graph", dependencyRealpaths: [], entryRelativePath: "entry.js"}
    },
  })
  afterAll(async () => { await manager.dispose(); rmSync(directory, {recursive: true, force: true}) })
  manager.sync(registry.packageDescriptors().filter(descriptor => descriptor.packageId === props.packageId))
  const snapshot = await manager.ensure(props.packageId, {owner: "check"})

  test("Выбранный владелец", () => {
    expect(snapshot.packageId, "Сборка относится к точной identity выбранного пакета").toBe(props.packageId)
  })
  test("Готовая ревизия", () => {
    expect(snapshot.buildState, "Успешный injected builder публикует подготовленную ревизию пакета").toBe("built")
    expect(snapshot.builds, "Первый явный check запускает одну подготовку").toBe(1)
  })
})
