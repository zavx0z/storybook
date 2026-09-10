import {expect, test} from "bun:test"
import {mkdtemp, mkdir, rm, symlink} from "node:fs/promises"
import {join} from "node:path"
import {discoverStorybookDirectories} from "./directories.ts"
import {readDependencySpec} from "./dependency-spec.ts"

const expected = {
  "component/index.tsx#Example": {uses: ["leaf.tsx#Leaf"], elements: ["article"]},
  "leaf.tsx#Leaf": {uses: [], elements: ["span"]},
}
const source = (graph = expected) => `
import {test} from "bun:test"
throw new Error("Исходник не должен исполняться")
test.each([{name: "Example", file: "component/index.tsx", expected: ${JSON.stringify(graph)}}])("Граф $name", () => {})
`

test("[STORYBOOK-DEPS-DISCOVERY] spec даёт модулю граф и наблюдаемый источник без исполнения кода", async () => {
  const root = await mkdtemp(join(import.meta.dir, "../tests/.deps-test-"))
  try {
    await mkdir(join(root, "component/spec"), {recursive: true})
    await Bun.write(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {types: []}, include: ["**/*.ts", "**/*.tsx"]}))
    await Bun.write(join(root, "component/index.tsx"), "export function Example() { return <article /> }")
    const path = join(root, "component/spec/deps.spec.ts")
    const before = await discoverStorybookDirectories(root, new Set())
    expect(before.directories[0]!.dependencySpec).toBeUndefined()
    expect(before.watchPaths).toContain(path)
    await Bun.write(path, source())
    const found = await discoverStorybookDirectories(root, new Set())
    expect(found.directories.map(value => value.relativePath)).toEqual(["component"])
    const spec = found.directories[0]!.dependencySpec!
    expect(spec.sourcePath).toBe(path)
    expect(spec.cases).toEqual([{name: "Example", file: "component/index.tsx", testName: "Граф $name", graph: expected}])
    await Bun.write(path, source() + "\n// Изменён исходник")
    expect((await readDependencySpec(root, path)).sourceDigest).not.toBe(spec.sourceDigest)
    await Bun.write(join(root, ".gitignore"), "component/spec/\n")
    expect((await discoverStorybookDirectories(root, new Set())).directories[0]!.dependencySpec).toBeUndefined()
    await Bun.write(join(root, ".gitignore"), "")
    await rm(path)
    await symlink(join(root, "component/index.tsx"), path)
    expect((await discoverStorybookDirectories(root, new Set())).directories[0]!.dependencySpec).toBeUndefined()
    await rm(path)
    await Bun.write(path, source({...expected, "component/index.tsx#Example": {uses: ["missing#Node"], elements: []}}))
    await expect(readDependencySpec(root, path)).rejects.toThrow("Неизвестная зависимость")
  } finally {
    await rm(root, {recursive: true, force: true})
  }
}, 25000)
