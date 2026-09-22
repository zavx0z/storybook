import {expect, test} from "bun:test"
import {mkdtemp, mkdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {readScenario} from "@archetypes/specs/scenarios"
import {createStorybookScenarioRunner} from "./scenario-run"
import type {ExternalStorybookRegistrySnapshot} from "../catalog/registry"
import type {ExternalStorybookSessionManager} from "../sessions/session-manager"

test("Сервер выполняет настоящий компонентный тест и возвращает проверенные props", async () => {
  const path = resolve(import.meta.dir, "../archetypes/specs/scenarios/spec/fixture/component/spec/scenario.spec.tsx")
  const prepared = await readScenario({path})
  if (prepared.preview?.kind !== "component") throw new Error("Нет компонентного сценария")
  const root = await mkdtemp(resolve(tmpdir(), "storybook-component-run-"))
  const nodeId = "component:command"
  const packageId = "@fixture/scenario-component"
  try {
    await mkdir(resolve(root, "scenarios"))
    await Bun.write(resolve(root, "scenarios", `${encodeURIComponent(nodeId)}.json`), JSON.stringify(prepared))
    const snapshot = {graph: {nodes: [{id: nodeId, packageId, scenarioSpec: {sourcePaths: [prepared.path]}}]}} as unknown as ExternalStorybookRegistrySnapshot
    const sessions = {session: () => ({revisionDirectory: () => root})} as unknown as ExternalStorybookSessionManager
    const run = createStorybookScenarioRunner()
    const input = {nodeId, revision: "revision", variantId: prepared.preview.variants[1]!.id,
      props: {label: "Проверено", disabled: true}}
    const result = await run(input, packageId, snapshot, sessions, new AbortController().signal)
    expect(result.execution.status).toBe("passed")
    expect(result.props).toEqual({label: "Проверено", disabled: true})
    expect(result.execution.tests.every(test => test.status === "passed")).toBeTrue()
    const failed = await run({...input, props: {label: 123, disabled: true}}, packageId, snapshot, sessions, new AbortController().signal)
    expect(failed.execution.status).toBe("failed")
    expect(failed.execution.tests.some(test => test.status === "failed")).toBeTrue()
  } finally {
    await rm(root, {recursive: true, force: true})
  }
}, 30_000)
