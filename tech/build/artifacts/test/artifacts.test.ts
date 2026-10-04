import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join, relative, resolve} from "node:path"
import {pathToFileURL} from "node:url"
import Artifacts from "@storybook-tech-build/artifacts"

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")

test("один native проход создаёт namespace и не заменяет опубликованные байты", async () => {
  const directory = mkdtempSync(join(tmpdir(), "shared-artifact-collision-"))
  const root = join(directory, "published")
  const staging = join(directory, "staging")
  try {
    const source = join(directory, "entry.ts")
    writeFileSync(source, "export const value = 42\n")
    const config = {entrypoints: [source], target: "browser" as const, outdir: join(staging, "kernel"),
      sourcemap: "external" as const,
      naming: {entry: "[name]-[hash].[ext]", chunk: "chunks/[name]-[hash].[ext]"}}
    const original = await Bun.build(config)
    const collided = relative(staging, original.outputs.find(item => item.kind === "entry-point")!.path)
    mkdirSync(dirname(join(root, collided)), {recursive: true})
    writeFileSync(join(root, collided), "retained old bytes")
    let configurations = 0
    const result = await Artifacts.build(async () => {
      configurations += 1
      let closed = false
      return {...config, plugins: [{name: "single-use-compiler", setup(builder) {
        if (closed) throw new Error("Compiler session is closed")
        builder.onEnd(() => { closed = true })
      }}]}
    })
    expect(configurations).toBe(1)
    expect(result.success).toBeTrue()
    const entry = result.outputs.find(item => item.kind === "entry-point")!
    expect(relative(staging, entry.path)).toMatch(/^kernel\/[a-f0-9]{64}\//u)
    const artifacts = await Promise.all(result.outputs.map(async item => ({
      path: relative(staging, item.path), digest: digest(new Uint8Array(await item.arrayBuffer())),
    })))
    Artifacts.publish(root, staging, artifacts)
    Artifacts.publish(root, staging, artifacts)
    expect(readFileSync(join(root, collided), "utf8")).toBe("retained old bytes")
    expect(readFileSync(join(root, relative(staging, entry.path)), "utf8")).toContain("42")
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
})

test("relative chunks исполняются после переноса, те же inputs переиспользуют URLs и карты", async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "shared-artifact-relative-")))
  const root = join(directory, "published")
  try {
    const source = join(directory, "shared.ts")
    const entries = [join(directory, "first.ts"), join(directory, "second.ts")]
    writeFileSync(source, "export const value = 42\n")
    for (const entry of entries) writeFileSync(entry, 'export {value} from "./shared.ts"\n')
    let nativePasses = 0
    const build = async (name: string) => {
      const staging = join(directory, name)
      const result = await Artifacts.build(async () => ({
        entrypoints: entries,
        outdir: join(staging, "kernel"),
        target: "browser",
        format: "esm",
        splitting: true,
        sourcemap: "external",
        metafile: true,
        naming: {entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]"},
        plugins: [{name: "count-native-passes", setup(builder) {
          builder.onEnd(() => { nativePasses += 1 })
        }}],
      }))
      expect(result.success).toBeTrue()
      const artifacts = await Promise.all(result.outputs.map(async artifact => ({
        path: relative(staging, artifact.path),
        digest: digest(new Uint8Array(await artifact.arrayBuffer())),
      })))
      Artifacts.publish(root, staging, artifacts)
      return {result, artifacts, staging}
    }
    const first = await build("candidate-one")
    const published = new Map(first.artifacts.map(artifact => [artifact.path, readFileSync(join(root, artifact.path))]))
    const second = await build("candidate-two")
    expect(nativePasses).toBe(2)
    expect(second.artifacts).toEqual(first.artifacts)
    expect(first.result.outputs.some(output => output.kind === "chunk")).toBeTrue()
    for (const output of second.result.outputs.filter(output => output.kind === "entry-point")) {
      const publishedEntry = join(root, relative(second.staging, output.path))
      expect((await import(pathToFileURL(publishedEntry).href)).value).toBe(42)
      expect(output.sourcemap?.path).toBe(`${output.path}.map`)
      const map = JSON.parse(await output.sourcemap!.text())
      for (const sourcePath of map.sources) expect(existsSync(resolve(dirname(output.sourcemap!.path), sourcePath))).toBeTrue()
    }
    // Bun оставляет прежний hash JS при правке комментария, но меняет sourcesContent и mappings.
    writeFileSync(source, "// изменилось только положение исходного выражения\nexport const value = 42\n")
    const third = await build("candidate-three")
    expect(nativePasses).toBe(3)
    const firstEntry = first.result.outputs.find(output => output.kind === "entry-point")!
    const thirdEntry = third.result.outputs.find(output => output.kind === "entry-point")!
    expect(thirdEntry.path.split("/").at(-1)).toBe(firstEntry.path.split("/").at(-1))
    expect(await thirdEntry.text()).toBe(await firstEntry.text())
    expect(third.artifacts[0]!.path).not.toBe(first.artifacts[0]!.path)
    const thirdMap = third.result.outputs.find(output => output.kind === "chunk")!.sourcemap!
    const parsedMap = JSON.parse(await thirdMap.text())
    expect(parsedMap.sourcesContent).toContain(readFileSync(source, "utf8"))
    expect(parsedMap.sources.map((path: string) => resolve(dirname(thirdMap.path), path))).toContain(source)
    for (const [path, bytes] of published) expect(readFileSync(join(root, path))).toEqual(bytes)
    const fourth = await build("candidate-four")
    expect(nativePasses).toBe(4)
    expect(fourth.artifacts).toEqual(third.artifacts)
    writeFileSync(source, "export const value = 43\n")
    const fifth = await build("candidate-five")
    expect(nativePasses).toBe(5)
    const fifthEntry = fifth.result.outputs.find(output => output.kind === "entry-point")!
    expect((await import(pathToFileURL(join(root, relative(fifth.staging, fifthEntry.path))).href)).value).toBe(43)
    expect((await import(pathToFileURL(join(root, relative(first.staging, firstEntry.path))).href)).value).toBe(42)
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
})

test("публикация отклоняет замену immutable файла до изменения остальных файлов", () => {
  const directory = mkdtempSync(join(tmpdir(), "shared-artifact-guard-"))
  const root = join(directory, "published")
  const staging = join(directory, "staging")
  mkdirSync(root)
  mkdirSync(staging)
  try {
    writeFileSync(join(root, "existing.js"), "old")
    writeFileSync(join(staging, "existing.js"), "new")
    writeFileSync(join(staging, "fresh.js"), "fresh")
    expect(() => Artifacts.publish(root, staging, [{path: "fresh.js", digest: digest("fresh")}, {path: "existing.js", digest: digest("new")}])).toThrow("collision")
    expect(readFileSync(join(root, "existing.js"), "utf8")).toBe("old")
    expect(existsSync(join(root, "fresh.js"))).toBeFalse()
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
})
