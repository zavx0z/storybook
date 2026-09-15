import {expect, test} from "bun:test"
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {prepareStorybookScenarios} from "./package-build.ts"
import type {StorybookPackageBuildDescriptor} from "../sessions/package-session.ts"

test("готовит один preview только для однозначного поддержанного scenario source", async () => {
  const supported = resolve(
    import.meta.dir,
    "../archetypes/specs/scenarios/spec/fixture/component/spec/scenario.spec.tsx",
  )
  const functionSource = resolve(import.meta.dir, "../archetypes/package/spec/scenario.spec.ts")
  const descriptor = {
    scenarioSpecs: [
      {nodeId: "subject:supported", sourcePaths: [supported]},
      {nodeId: "subject:function", sourcePaths: [functionSource]},
      {nodeId: "subject:ambiguous", sourcePaths: [supported, supported]},
    ],
  } as unknown as StorybookPackageBuildDescriptor

  const result = await prepareStorybookScenarios(descriptor, new AbortController().signal)

  expect(result).toMatchObject([{
    kind: "component",
    nodeId: "subject:supported",
    module: {
      path: realpathSync(resolve(import.meta.dir, "../archetypes/specs/scenarios/spec/fixture/component/spec/fixture/index.tsx")),
      export: "CommandFixture",
    },
    variants: [{title: "Доступная команда"}, {title: "Недоступная команда"}],
  }, {
    kind: "function",
    nodeId: "subject:function",
    variants: [{title: "Корневой пакет"}, {title: "Вложенный пакет"}],
  }])
  expect(result[1]).not.toHaveProperty("module")
}, 30_000)

test("не исполняет неподдержанный scenario во время подготовки", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "storybook-unsupported-scenario-"))
  const path = resolve(root, "scenario.spec.ts")
  writeFileSync(path, 'throw new Error("Этот source нельзя исполнять")\n')
  try {
    const descriptor = {
      scenarioSpecs: [{nodeId: "subject:unsupported", sourcePaths: [path]}],
    } as unknown as StorybookPackageBuildDescriptor

    expect(await prepareStorybookScenarios(descriptor, new AbortController().signal)).toEqual([])
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
