import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {readParameterizedTests} from "./read-parameterized-tests.ts"

const root = resolve(import.meta.dir, "../../webxr-space")

test("[DIAGRAM-TEST-PARAMETERS] чтение spec возвращает название теста и полную параметризацию", async () => {
  const declarations = await readParameterizedTests(root, resolve(root, "nodes/node/diagram/spec/deps.spec.ts"))

  expect(declarations, "Spec должен содержать один test.each с исходным названием и полным массивом параметров DiagramNode").toEqual([
    {
      name: "[DIAGRAM-DEPENDENCIES] $name: полный граф компонентов и нативных элементов",
      describes: [],
      parameters: [
        {
          name: "DiagramNode",
          file: "nodes/node/diagram/index.tsx",
          expected: {
            "nodes/node/diagram/index.tsx#DiagramNode": {
              uses: ["ui/surfaces/pane.tsx#Pane", "ui/typography.tsx#Typography"],
              elements: ["article"],
            },
            "ui/surfaces/pane.tsx#Pane": {uses: [], elements: ["section"]},
            "ui/typography.tsx#Typography": {uses: [], elements: ["span"]},
          },
        },
      ],
    },
  ])
})

test("[TEST-PARAMETERS-NESTED] сохраняет describe.each и исходник функции без исполнения", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "storybook-parameterized-tests-"))
  const runtime = `async (props: {name: string}) => {
    const {Example} = await import("./missing.tsx")
    return <Example name={props.name} />
  }`
  try {
    await Bun.write(resolve(fixture, "tsconfig.json"), JSON.stringify({compilerOptions: {types: []}, include: ["*.tsx"]}))
    const file = resolve(fixture, "scenario.spec.tsx")
    await Bun.write(file, `import {describe, test} from "bun:test"
describe.each([{name: "Первый", props: {size: 10}}, {name: "Второй", props: {size: 20}}])("$name", () => {
  test.each([{runtime: ${runtime}}])("$runtime сохраняется", () => {})
})`)
    expect(await readParameterizedTests(fixture, file)).toEqual([{
      name: "$runtime сохраняется",
      describes: [{name: "$name", parameters: [
        {name: "Первый", props: {size: 10}},
        {name: "Второй", props: {size: 20}},
      ]}],
      parameters: [{runtime: {kind: "function", source: runtime}}],
    }])
  } finally { await rm(fixture, {recursive: true, force: true}) }
})
