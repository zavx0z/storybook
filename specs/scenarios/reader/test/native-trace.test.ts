import {expect, test} from "bun:test"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {join, resolve} from "node:path"
import {traceScenario} from "../src/trace"

test("trace инструментирует исходный TSX до native lowering и сохраняет позиции вызовов без GPU", async () => {
  const directory = await mkdtemp(join(import.meta.dir, ".native-trace-"))
  const path = join(directory, "scenario.spec.tsx")
  const source = `import {describe, expect, test} from "bun:test"
import Counter from "./counter.tsx"
import {readLabel} from "./read-label.ts"
describe("native descriptor", () => {
  const construction = <Counter label="compiled" />
  const label = readLabel(construction)
  test("same props", () => { expect(label).toBe("compiled") })
})
`
  try {
    await Bun.write(join(directory, "package.json"), JSON.stringify({name: "@fixture/native-trace", type: "module", devDependencies: {"@zavx0z/immersive": "^0.0.0"}}))
    await Bun.write(join(directory, "tsconfig.json"), JSON.stringify({extends: resolve(import.meta.dir, "../../../../tsconfig.json"), include: ["*.ts", "*.tsx"]}))
    await Bun.write(join(directory, "counter.tsx"), 'export default function Counter(props: {label: string}) { return <button>{props.label}</button> }\n')
    await Bun.write(join(directory, "read-label.ts"), 'export function readLabel(value: {props: {label: string}}) { return value.props.label }\n')
    await Bun.write(path, source)
    const report = await traceScenario({path})
    expect(report.exitCode, report.stderr).toBe(0)
    expect(report.tests.map(test => test.status)).toEqual(["passed"])
    const call = report.calls.find(call => call.name === "readLabel")
    expect(call).toBeDefined()
    expect(call!.location).toEqual({path, line: 6, column: 17})
    expect(call!.describe).toEqual(["native descriptor"])
    expect(report.assertions).toHaveLength(1)
    expect(report.assertions[0]!.location).toEqual({path, line: 7, column: 30})
    expect(await readFile(path, "utf8")).toBe(source)
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
}, 30000)
