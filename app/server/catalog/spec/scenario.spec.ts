/** Каталог принимает структурное обнаружение и выдаёт точные корни графа. */
import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import Registry from "@app-server/catalog"
import discoverStorybookPackages from "@repo/discovery"

const fixtureRoot = join(import.meta.dir, "../../../../repo/discovery/fixtures/valid")

describe.each([
  {name: "Один Repo", props: {roots: [fixtureRoot], ids: ["package:fixture-workspace"]}},
  {name: "Repo и независимый пакет", props: {
    roots: [fixtureRoot, join(fixtureRoot, "standalone")],
    ids: ["package:fixture-workspace", "package:@fixture/standalone"],
  }},
])("$name", async ({props}) => {
  const registry = new Registry(discoverStorybookPackages)
  const snapshot = await registry.configure(props.roots)

  test("Подключённые корни", () => {
    expect(snapshot.entries.map(entry => entry.canonicalId),
      "Только выбранные package identities выступают подключёнными корнями"
    ).toEqual([...props.ids])
  })
  test("Согласованный граф", () => {
    expect(snapshot.graph.rootIds, "Граф и реестр ссылаются на одинаковые корневые узлы").toEqual(props.ids)
    expect(snapshot.entries[0]?.descendantIds, "Вложенный пакет остаётся частью выбранного Repo").toContain("package:@fixture/components")
  })
})
