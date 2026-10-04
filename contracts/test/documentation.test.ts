import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "@storybook-specs-scenarios/reader"
import {createFixture} from "./fixture"

test("Contracts передаёт нарушение документации из сценария TypeDoc", async () => {
  const fixture = await createFixture()
  try {
    const path = resolve(fixture.root, "contract/index.ts")
    const source = await Bun.file(path).text()
    await fixture.write("contract/index.ts", source.replace(/\/\*\*[\s\S]*?\*\//gu, ""))
    const report = await readScenario({
      path: resolve(import.meta.dir, "../spec/scenario.spec.ts"),
      variant: 0,
      props: {path: fixture.root},
    })
    expect(report.tests.find(point => point.label === "Документация контракта")?.status,
      "Родительский сценарий не объявляет контракт прошедшим проверку, когда TypeDoc обнаружил отсутствие описания").toBe("failed")
    expect(report.exitCode, "Нарушение дочернего сценария влияет на итог запуска Contracts").not.toBe(0)
  } finally {
    await fixture.close()
  }
}, 30_000)
