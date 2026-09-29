import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join, relative} from "node:path"
import {buildSharedArtifactGraph, publishSharedArtifacts} from "./shared-artifacts.ts"

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")

test("коллизия имени Bun создаёт другой URL и не заменяет опубликованные байты", async () => {
  const directory = mkdtempSync(join(tmpdir(), "shared-artifact-collision-"))
  const root = join(directory, "published")
  const staging = join(directory, "staging")
  try {
    const source = join(directory, "entry.ts")
    writeFileSync(source, "export const value = 42\n")
    const config = {entrypoints: [source], target: "browser" as const, outdir: staging,
      publicPath: "/__storybook/shared/", sourcemap: "external" as const,
      naming: {entry: "kernel/[name]-[hash].[ext]", chunk: "kernel/chunks/[name]-[hash].[ext]"}}
    const original = await Bun.build(config)
    const collided = relative(staging, original.outputs.find(item => item.kind === "entry-point")!.path)
    mkdirSync(dirname(join(root, collided)), {recursive: true})
    writeFileSync(join(root, collided), "retained old bytes")
    let configurations = 0
    const result = await buildSharedArtifactGraph(async () => {
      configurations += 1
      let closed = false
      return {...config, plugins: [{name: "single-use-compiler", setup(builder) {
        if (closed) throw new Error("Compiler session is closed")
        builder.onEnd(() => { closed = true })
      }}]}
    }, staging)
    expect(configurations).toBe(2)
    expect(result.success).toBeTrue()
    const entry = result.outputs.find(item => item.kind === "entry-point")!
    expect(relative(staging, entry.path)).toMatch(/^kernel\/[a-f0-9]{64}\//u)
    const artifacts = await Promise.all(result.outputs.map(async item => ({
      path: relative(staging, item.path), digest: digest(new Uint8Array(await item.arrayBuffer())),
    })))
    publishSharedArtifacts(root, staging, artifacts)
    publishSharedArtifacts(root, staging, artifacts)
    expect(readFileSync(join(root, collided), "utf8")).toBe("retained old bytes")
    expect(readFileSync(join(root, relative(staging, entry.path)), "utf8")).toContain("42")
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
    expect(() => publishSharedArtifacts(root, staging, [{path: "fresh.js", digest: digest("fresh")}, {path: "existing.js", digest: digest("new")}])).toThrow("collision")
    expect(readFileSync(join(root, "existing.js"), "utf8")).toBe("old")
    expect(existsSync(join(root, "fresh.js"))).toBeFalse()
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
})
