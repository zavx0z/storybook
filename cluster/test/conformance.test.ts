import {expect, test} from "bun:test"
import {rm} from "node:fs/promises"
import {resolve} from "node:path"
import {pathToFileURL} from "node:url"
import readScenario from "@archetypes/scenario-reader"
import {prepareClusterExample} from "../spec/prepare"

test("один нормативный сценарий подтверждает Cluster и собственного участника", async () => {
  const root = await prepareClusterExample()
  try {
    for (const path of [resolve(root, "group"), resolve(root, "group/increment")]) {
      const result = await readScenario({path: resolve(import.meta.dir, "../../package/reader/spec/scenario.spec.ts"), props: {path}})
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.tests.filter(point => point.status !== "passed" && !(point.status === "skipped" && point.skipReason))).toEqual([])
    }
    const {Increment} = await import(pathToFileURL(resolve(root, "group/index.ts")).href)
    const input = {value: 3, step: 2}
    expect(Increment(input)).toBe(5)
    expect(input).toEqual({value: 3, step: 2})
  } finally {
    await rm(root, {recursive: true, force: true})
  }
}, 30_000)
