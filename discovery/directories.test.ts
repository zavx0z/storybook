import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {discoverStorybookDirectories} from "./directories.ts"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

test("finds ordinary and empty directories, skips src and keeps packages as separate owners", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-directories-")))
  roots.push(root)
  expect(await Bun.spawn(["git", "init", "--quiet", root]).exited).toBe(0)
  await Bun.write(join(root, ".gitignore"), "node_modules/\n")
  for (const path of ["docs/guide", "docs/src/private", "empty", "src/hidden", "packages/tool/stories", "node_modules/dependency", "build", ".storybook/stories", "tests/unit", "test/unit", "docs/.storybook/stories", "docs/tests/unit", "docs/test/unit"]) {
    await mkdir(join(root, path), {recursive: true})
  }
  await Bun.write(join(root, "docs/README.md"), "# Documentation")
  await Bun.write(join(root, "docs/index.ts"), "/**\n# Module documentation\n@packageDocumentation\n*/\nexport const value = 1")
  await symlink(join(root, "docs"), join(root, "linked"))
  const result = await discoverStorybookDirectories(root, new Set([join(root, "packages/tool")]))
  expect(result.directories.map(directory => directory.name)).toEqual(["build", "docs", "empty", "packages"])
  const docs = result.directories.find(directory => directory.name === "docs")!
  expect(docs.readmePath).toBeNull()
  expect(docs.moduleDocumentation?.markdown).toBe("# Module documentation")
  expect(result.watchPaths).toContain(join(root, "docs/index.ts"))
  expect(result.watchPaths).not.toContain(join(root, "docs/README.md"))
  expect(result.directories.some(directory => directory.relativePath.includes("/"))).toBeFalse()
  expect(result.watchPaths).not.toContain(join(root, "docs/guide"))
  expect((await discoverStorybookDirectories(join(root, "docs"), new Set())).directories.map(directory => directory.name)).toEqual(["guide"])
  expect(result.watchPaths).toContain(join(root, "empty"))
  expect(result.watchPaths).not.toContain(join(root, "packages/tool"))
})

test("types следует обычным границам каталогов, модулей и shared", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-types-directory-")))
  roots.push(root)
  await mkdir(join(root, "types/private"), {recursive: true})
  await mkdir(join(root, "protocol/types/src"), {recursive: true})
  await mkdir(join(root, "shared/types/internal"), {recursive: true})
  await Bun.write(join(root, "types/index.ts"), "export interface Helper {}")
  await Bun.write(join(root, "protocol/types/index.ts"), "/** Протокол раскладки.\n@packageDocumentation\n*/")
  const read = () => discoverStorybookDirectories(root, new Set())
  const found = await read()
  expect(found.directories.map(dir => [dir.relativePath, dir.structuralRole])).toEqual([
    ["protocol", "category"], ["protocol/types", "module"],
    ["types", "directory"], ["types/private", "directory"],
  ])
  expect(found.watchPaths).toContain(join(root, "types/src"))
  await rm(join(root, "protocol/types/src"), {recursive: true})
  expect((await read()).directories.map(dir => dir.relativePath)).toEqual([
    "protocol", "protocol/types", "types", "types/private",
  ])
})

test.each(["index.ts", "index.tsx"])("README не заменяет отсутствующий, игнорируемый или symlink %s", async entry => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-doc-source-")))
  roots.push(root)
  await Bun.spawn(["git", "init", "--quiet", root]).exited
  await mkdir(join(root, "module"))
  await Bun.write(join(root, "module/README.md"), "Не обзор")
  const read = async () => (await discoverStorybookDirectories(root, new Set())).directories[0]!
  expect((await read()).moduleDocumentation).toBeUndefined()
  await Bun.write(join(root, `module/${entry}`), "/**\nОписание\n@packageDocumentation\n*/")
  expect((await read()).moduleDocumentation?.markdown).toBe("Описание")
  await Bun.write(join(root, ".gitignore"), `module/${entry}\n`)
  expect((await read()).moduleDocumentation).toBeUndefined()
  expect((await read()).structuralRole).toBe("directory")
  await Bun.write(join(root, ".gitignore"), "")
  await rm(join(root, `module/${entry}`))
  await symlink(join(root, "module/README.md"), join(root, `module/${entry}`))
  expect((await read()).moduleDocumentation).toBeUndefined()
  expect((await read()).structuralRole).toBe("directory")
})

test("index.tsx завершает обход без src и владеет обзором при наличии index.ts", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-tsx-entry-")))
  roots.push(root)
  await mkdir(join(root, "group/component/internal/deep"), {recursive: true})
  await Bun.write(join(root, "group/index.ts"), '/**\nГруппа\n@packageDocumentation\n*/\nexport * from "./component"')
  await Bun.write(join(root, "group/component/index.ts"), '/**\nСтарое описание\n@packageDocumentation\n*/')
  const entry = join(root, "group/component/index.tsx")
  await Bun.write(entry, '/**\nКомпонент\n@packageDocumentation\n*/\nexport function Component() { return <div /> }\nthrow new Error("Не исполнять")')
  const found = await discoverStorybookDirectories(root, new Set())
  expect(found.directories.map(dir => [dir.relativePath, dir.structuralRole])).toEqual([
    ["group", "category"], ["group/component", "module"],
  ])
  expect(found.directories[1]?.moduleDocumentation?.markdown).toBe("Компонент")
  expect(found.directories[1]?.moduleDocumentation?.sourcePath).toBe(entry)
  expect(found.watchPaths).toContain(entry)
  expect(found.watchPaths).toContain(join(root, "group/index.tsx"))
  expect(found.watchPaths).not.toContain(join(root, "group/component/internal"))
  await Bun.write(entry, 'export function Component() { return <div /> }')
  const undocumented = (await discoverStorybookDirectories(root, new Set())).directories[1]!
  expect(undocumented.structuralRole).toBe("module")
  expect(undocumented.moduleDocumentation).toBeUndefined()
  await rm(entry)
  const restored = await discoverStorybookDirectories(root, new Set())
  expect(restored.directories[1]?.moduleDocumentation?.markdown).toBe("Старое описание")
  expect(restored.directories.some(dir => dir.relativePath === "group/component/internal/deep")).toBeTrue()
})

test("uses Git ignore precedence, negation, nested files and ignored tracked directories", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-gitignore-")))
  roots.push(root)
  expect(await Bun.spawn(["git", "init", "--quiet", root]).exited).toBe(0)
  for (const path of ["docs/guide/private", "docs/guide/public", "docs/draft", "tracked-cache", "build", "dist", "visible space"]) {
    await mkdir(join(root, path), {recursive: true})
  }
  await Bun.write(join(root, "tracked-cache/file.txt"), "tracked")
  expect(await Bun.spawn(["git", "-C", root, "add", "tracked-cache/file.txt"]).exited).toBe(0)
  await Bun.write(join(root, ".gitignore"), "dist/\ntracked-cache/\ndocs/*\n!docs/guide/\n")
  await Bun.write(join(root, "docs/guide/.gitignore"), "private/\n")
  const result = await discoverStorybookDirectories(root, new Set())
  expect(result.directories.map(directory => directory.relativePath)).toEqual(["build", "docs", "docs/guide", "docs/guide/public", "visible space"])
  expect((await discoverStorybookDirectories(join(root, "docs"), new Set())).directories.map(directory => directory.name)).toEqual(["guide", "public"])
  expect(result.watchPaths).toContain(join(root, "docs/guide/.gitignore"))
  expect((await discoverStorybookDirectories(join(root, "docs/guide"), new Set())).directories.map(directory => directory.name)).toEqual(["public"])
  await Bun.write(join(root, "docs/guide/.gitignore"), "public/\n")
  expect((await discoverStorybookDirectories(join(root, "docs/guide"), new Set())).directories.map(directory => directory.name)).toEqual(["private"])
})
