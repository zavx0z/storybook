import {expect, test} from "bun:test"
import {mkdtemp, mkdir, rm, symlink} from "node:fs/promises"
import {join} from "node:path"
import {discoverStorybookDirectories} from "./directories.ts"

test.each(["component", "operation", "operation-without-src", "documentation"])("[SCENARIOS-PRESENCE] пустой файл, обе формы, удаление и исключения: %s", async kind => {
  const root = await mkdtemp(join(import.meta.dir, "../tests/.scenarios-"))
  try {
    const owner = join(root, kind)
    await mkdir(join(owner, "spec"), {recursive: true})
    if (kind === "component") await Bun.write(join(owner, "index.tsx"), "export function Component() { return <article /> }")
    else if (kind === "operation-without-src") await Bun.write(join(owner, "index.ts"), "export function operation() { return 1 }")
    else if (kind === "documentation") await Bun.write(join(owner, "index.ts"), "/**\nОписание сущности.\n@packageDocumentation\n*/")
    else {
      await mkdir(join(owner, "src"))
      await Bun.write(join(owner, "src/value.ts"), "export const value = 1")
      await Bun.write(join(owner, "index.ts"), 'import {value} from "./src/value.ts"\nexport function operation() { return value }')
    }
    const ts = join(owner, "spec/scenario.spec.ts")
    const tsx = join(owner, "spec/scenario.spec.tsx")
    const removedName = join(owner, "spec/story.spec.ts")
    const read = () => discoverStorybookDirectories(root, new Set())
    const empty = await read()
    expect(empty.watchPaths).toContain(ts)
    expect(empty.watchPaths).toContain(tsx)
    expect(empty.watchPaths).not.toContain(removedName)
    expect(empty.directories[0]!.scenarioSpec).toBeUndefined()
    await Bun.write(removedName, "")
    expect((await read()).directories[0]!.scenarioSpec).toBeUndefined()
    await rm(removedName)
    await Bun.write(ts, "")
    expect((await read()).directories[0]!.scenarioSpec?.sourcePaths).toEqual([ts])
    await Bun.write(tsx, 'throw new Error("Этот файл нельзя выполнять или разбирать как сценарий на этапе присутствия")')
    expect((await read()).directories[0]!.scenarioSpec?.sourcePaths).toEqual([ts, tsx])
    await rm(ts)
    expect((await read()).directories[0]!.scenarioSpec?.sourcePaths).toEqual([tsx])
    await Bun.write(join(root, ".gitignore"), `${kind}/spec/scenario.spec.tsx\n`)
    expect((await read()).directories[0]!.scenarioSpec).toBeUndefined()
    await Bun.write(join(root, ".gitignore"), "")
    await rm(tsx)
    expect((await read()).directories[0]!.scenarioSpec).toBeUndefined()
    await symlink(join(owner, kind === "component" ? "index.tsx" : "index.ts"), ts)
    expect((await read()).directories[0]!.scenarioSpec).toBeUndefined()
    await rm(ts)
    await mkdir(tsx)
    expect((await read()).directories[0]!.scenarioSpec).toBeUndefined()
  } finally { await rm(root, {recursive: true, force: true}) }
})
