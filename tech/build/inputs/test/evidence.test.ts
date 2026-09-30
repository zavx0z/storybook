import {afterEach, describe, expect, test} from "bun:test"
import {mkdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import BuildInputs from "@build/inputs"
import {createFixture} from "./fixture"

const fixtures: ReturnType<typeof createFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose()
})

/** Регистрирует временный root для cleanup даже при неуспешном ожидании. */
function fixture() {
  const value = createFixture()
  fixtures.push(value)
  return value
}

describe("Версионированное evidence", () => {
  test("read, parse, same и paths сохраняют исходный снимок", () => {
    const current = fixture()
    const plan = BuildInputs.plan(current.input)
    const first = BuildInputs.read(plan)
    const second = BuildInputs.read(plan)
    expect(first.protocol).toBe("storybook-build-input/2")
    expect(BuildInputs.protocol).toBe(first.protocol)
    expect(BuildInputs.parse(JSON.parse(JSON.stringify(first)))).toEqual(first)
    expect(BuildInputs.same(first, second)).toBeTrue()
    expect(second.files[0]).not.toBe(first.files[0])
    expect(BuildInputs.paths(first)).toContain(current.source)
    expect(BuildInputs.paths(first)).toContain(current.root)
    expect(Object.isFrozen(first)).toBeTrue()
    expect(Object.isFrozen(first.files)).toBeTrue()
  })

  test("неполные, старые и подменённые данные дают miss", () => {
    const current = fixture()
    const evidence = BuildInputs.read(BuildInputs.plan(current.input))
    for (const invalid of [
      null,
      {},
      {...evidence, protocol: "storybook-build-input/1"},
      {...evidence, digest: "0".repeat(64)},
      {...evidence, directories: undefined},
      {...evidence, roots: [current.root, current.root]},
      {...evidence, files: [{...evidence.files[0], size: -1}]},
      {...evidence, files: [{...evidence.files[0], inode: "-1"}]},
      {...evidence, files: [{...evidence.files[0], path: "relative.ts"}]},
    ]) {
      expect(BuildInputs.parse(invalid)).toBeNull()
      expect(BuildInputs.paths(invalid)).toBeNull()
      expect(BuildInputs.same(evidence, invalid)).toBeFalse()
    }
  })

  test("canonical identity и roots не зависят от порядка входа", () => {
    const current = fixture()
    const first = BuildInputs.plan({...current.input, identity: {a: 1, b: {c: true}}})
    const second = BuildInputs.plan({
      ...current.input,
      identity: {b: {c: true}, a: 1},
      roots: [current.compiler, current.root, current.root],
      files: [current.adapter, current.source, current.source],
    })
    expect(second.scope.roots).toEqual([current.root])
    expect(second.scope.files).toEqual(first.scope.files)
    expect(BuildInputs.same(BuildInputs.read(first), BuildInputs.read(second))).toBeTrue()
  })

  test("exact symlink и не-JSON identity отклоняются", () => {
    const current = fixture()
    const alias = join(current.root, "alias.ts")
    symlinkSync(current.source, alias)
    expect(() => BuildInputs.plan({...current.input, files: [alias]})).toThrow("exact non-symlink file")
    expect(() => BuildInputs.plan({...current.input, validationAbi: null as never})).toThrow("validationAbi must be an object")
    expect(() => BuildInputs.read(BuildInputs.plan({...current.input, identity: {number: Infinity}}))).toThrow("non-finite number")
  })
})

describe("Один verification pass", () => {
  test("переиспользует evidence и обновляет byte и directory inventory", () => {
    const current = fixture()
    const plan = BuildInputs.plan(current.input)
    const reader = new BuildInputs()
    const first = reader.read(plan)
    const second = reader.read(plan)
    expect(second.files.find(file => file.path === current.source)).toBe(first.files.find(file => file.path === current.source))
    writeFileSync(current.source, "export const value = 2\n")
    expect(reader.read(plan).digest).not.toBe(first.digest)
    writeFileSync(current.source, current.sourceText)
    expect(reader.read(plan).digest).toBe(first.digest)
    const extra = join(current.root, "ambient.d.ts")
    writeFileSync(extra, "declare const ambient: true\n")
    expect(reader.read(plan).digest).not.toBe(first.digest)
    rmSync(extra)
    expect(reader.read(plan).digest).toBe(first.digest)
    const empty = join(current.root, "empty")
    mkdirSync(empty)
    const expanded = reader.read(plan)
    expect(expanded.digest).toBe(first.digest)
    expect(expanded.directories).toContain(empty)
  })

  test("ctime обнаруживает запись при восстановленном mtime", () => {
    const current = fixture()
    const timestamp = 1_000_000_000
    utimesSync(current.source, timestamp, timestamp)
    const reader = new BuildInputs()
    const plan = BuildInputs.plan(current.input)
    const first = reader.read(plan)
    const original = first.files.find(file => file.path === current.source)!
    writeFileSync(current.source, "export const value = 2\n")
    utimesSync(current.source, timestamp, timestamp)
    expect(reader.read(plan).files.find(file => file.path === current.source)?.contentDigest).not.toBe(original.contentDigest)
  })

  test("same-byte replacement сохраняет restart key и обновляет identity", () => {
    const current = fixture()
    const reader = new BuildInputs()
    const plan = BuildInputs.plan(current.input)
    const first = reader.read(plan)
    const replacement = join(current.root, ".replacement")
    writeFileSync(replacement, current.sourceText)
    renameSync(replacement, current.source)
    const second = reader.read(plan)
    expect(BuildInputs.same(first, second)).toBeTrue()
    expect(second.files.find(file => file.path === current.source)?.inode).not.toBe(first.files.find(file => file.path === current.source)?.inode)
  })
})
