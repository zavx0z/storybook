import {expect, test} from "bun:test"
import {mkdtemp, mkdir, rm, symlink} from "node:fs/promises"
import {join} from "node:path"
import {discoverStorybookDirectories} from "./directories.ts"

test("[CONTRACT-DISCOVERY] вход/выход, обновление, удаление, ignore и symlink без исполнения", async () => {
  const root = await mkdtemp(join(import.meta.dir, "../tests/.contract-"))
  try {
    await mkdir(join(root, "component/contract"), {recursive: true})
    await Bun.write(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {types: [], noEmit: true}, include: ["**/*.ts", "**/*.tsx"]}))
    await Bun.write(join(root, "component/index.tsx"), "export function Component() { return <article /> }")
    const input = join(root, "component/contract/input.ts")
    const output = join(root, "component/contract/output.ts")
    const read = () => discoverStorybookDirectories(root, new Set())
    expect((await read()).watchPaths).toContain(input)
    expect((await read()).directories[0]!.contractDocumentation).toBeUndefined()
    await Bun.write(input, '/** Вход.\n@property [value=hello] - Текст поля.\n*/\nexport interface Input {value?: string}\nthrow new Error("Нельзя исполнять")')
    const first = (await read()).directories[0]!.contractDocumentation!
    expect(first.documents.map(value => value.direction)).toEqual(["input"])
    expect(first.documents[0]!.document.declarations[0]!.members[0]).toMatchObject({name: "value", optional: true, defaultValue: "hello"})
    await Bun.write(output, "export type Output = {ok: boolean}")
    expect((await read()).directories[0]!.contractDocumentation!.documents.map(value => value.direction)).toEqual(["input", "output"])
    await Bun.write(input, "export interface Input {count: number}")
    expect((await read()).directories[0]!.contractDocumentation!.sources[0]!.sourceDigest).not.toBe(first.sources[0]!.sourceDigest)
    await rm(input)
    expect((await read()).directories[0]!.contractDocumentation!.documents.map(value => value.direction)).toEqual(["output"])
    await Bun.write(join(root, ".gitignore"), "component/contract/\n")
    expect((await read()).directories[0]!.contractDocumentation).toBeUndefined()
    await Bun.write(join(root, ".gitignore"), "")
    await rm(output)
    await symlink(join(root, "component/index.tsx"), input)
    expect((await read()).directories[0]!.contractDocumentation).toBeUndefined()
  } finally { await rm(root, {recursive: true, force: true}) }
}, 60000)
