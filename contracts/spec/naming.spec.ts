/** Имя namespace выражает полное имя пакета, включая его scope. */
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readContract from "@zavx0z/storybook-contracts"
import {createFixture} from "../test/fixture"

describe.each([
  {
    name: "@zavx0z/storybook-app — Zavx0zStorybookApp",
    packageName: "@zavx0z/storybook-app",
    namespaceName: "Zavx0zStorybookApp",
    expected: "Zavx0zStorybookApp",
  },
  {
    name: "@zavx0z/storybook-app-web — Zavx0zStorybookAppWeb",
    packageName: "@zavx0z/storybook-app-web",
    namespaceName: "Zavx0zStorybookAppWeb",
    expected: "Zavx0zStorybookAppWeb",
  },
  {
    name: "web-worker — WebWorker",
    packageName: "web-worker",
    namespaceName: "WebWorker",
    expected: "WebWorker",
  },
  {
    name: "@build-tools/web-worker — BuildToolsWebWorker",
    packageName: "@build-tools/web-worker",
    namespaceName: "BuildToolsWebWorker",
    expected: "BuildToolsWebWorker",
  },
  {
    name: "Намеренно неверное имя @zavx0z/storybook-app — Contract",
    packageName: "@zavx0z/storybook-app",
    namespaceName: "Contract",
    expected: "Zavx0zStorybookApp",
  },
  {
    name: "Намеренно неверное имя @zavx0z/storybook-app-web — Web",
    packageName: "@zavx0z/storybook-app-web",
    namespaceName: "Web",
    expected: "Zavx0zStorybookAppWeb",
  },
])("$name", ({packageName, namespaceName, expected}) => {
  test("Имя, предупреждение и доступность ролей", async () => {
    const fixture = await createFixture("empty")
    try {
      await fixture.write("package.json", JSON.stringify({
        name: packageName,
        type: "module",
        exports: {".": "./index.ts"},
      }))
      await fixture.write("index.ts", `import type {${namespaceName}} from "./contract"\nexport type {${namespaceName}} from "./contract"\nexport default function run(input: ${namespaceName}.Input): ${namespaceName}.Output {return {result: input.value.length}}\n`)
      const contractPath = resolve(fixture.root, "contract/index.ts")
      await fixture.write("contract/index.ts", `export declare namespace ${namespaceName} {type Input = {readonly value: string}\ntype Output = {readonly result: number}}\n`)

      const result = await readContract({path: fixture.root})
      const namespace = result.entries[0]?.namespaces[0]

      expect(namespace?.declaration.name, "Читатель сохраняет фактическое имя исходного объявления").toBe(namespaceName)
      expect(result.diagnostics,
        "Совпадающее имя проходит без предупреждения; неверное имя даёт одну точную диагностику")
        .toEqual(namespaceName === expected ? [] : [{
          severity: "warning",
          code: "namespace-name",
          path: contractPath,
          message: `Namespace ${namespaceName} пакета ${packageName} ожидается с именем ${expected}`,
        }])
      expect(namespace?.roles.map(role => role.name),
        "Предупреждение об имени не мешает читать типовые роли").toEqual(["Input", "Output"])
      expect(namespace?.roles.find(role => role.name === "Input")?.fields,
        "Входная форма доступна и при предупреждении").toMatchObject([{name: "value", type: "string", optional: false}])
      expect(namespace?.roles.find(role => role.name === "Output")?.fields,
        "Результатная форма доступна и при предупреждении").toMatchObject([{name: "result", type: "number", optional: false}])
    } finally {
      await fixture.close()
    }
  })
})
