import {expect, test} from "bun:test"
import {existsSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import type {PlatformArtifacts} from "../contract/build.ts"
import {hash, readyFixture} from "./ready.fixture.ts"

type Reply = {
  ok: boolean
  message?: string
  result: PlatformArtifacts
  repeated: PlatformArtifacts
  archived: PlatformArtifacts
  phases: string[]
  compilations: number
  sameElement: boolean
  sameRegistry: boolean
  sameJsx: boolean
  sameSourceRuntime: boolean
  archiveError: string
  missingSourceError: string
  collisionError: string
  contents: string
}

async function run(f: ReturnType<typeof readyFixture>, action: "build" | "runtime" | "corrupt" | "source-artifact" = "build"): Promise<Reply> {
  const process = Bun.spawn([Bun.argv[0]!, "run", join(import.meta.dir, "ready-runner.fixture.ts"), JSON.stringify({input: f.input, owner: f.owner, action})], {
    stdout: "pipe", stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
  expect(code, stderr).toBe(0)
  return JSON.parse(stdout) as Reply
}

test("готовая поставка копируется без компиляции, все facades используют один runtime chunk", async () => {
  const f = readyFixture()
  try {
    const reply = await run(f, "runtime")
    expect(reply.ok, reply.message).toBe(true)
    expect(reply.compilations).toBe(0)
    expect(reply.phases).toEqual(["kernel:started", "kernel:completed"])
    const result = reply.result
    expect(result.artifacts).toHaveLength(f.manifest.files.length)
    for (const file of f.manifest.files) {
      const artifact = result.artifacts.find(artifact => artifact.path.endsWith(`/${file.path}`))!
      expect(artifact.path).toMatch(/^kernel\/[a-f0-9]{64}\//u)
      expect(artifact.digest).toBe(file.digest)
      expect(readFileSync(join(f.root, artifact.path), "utf8")).toBe(f.contents[file.path]!)
    }
    expect([reply.sameElement, reply.sameRegistry, reply.sameJsx]).toEqual([true, true, true])
    expect(reply.repeated).toEqual(result)
    expect(reply.archived).toEqual(result)
    expect(existsSync(f.stagingDirectory)).toBe(false)
  } finally { f.dispose() }
})

test.each(["wrong-digest", "missing-file", "symlink", "wrong-entry"])("готовая поставка отклоняет %s до публикации и удаляет staging", async failure => {
  const f = readyFixture()
  try {
    const runtime = join(f.readyRoot, "chunks/runtime.js")
    if (failure === "wrong-digest") writeFileSync(runtime, "export const changed = true\n")
    if (failure === "missing-file") rmSync(runtime)
    if (failure === "symlink") {
      rmSync(runtime)
      const outside = join(f.tool, "outside.js")
      writeFileSync(outside, f.contents["chunks/runtime.js"]!)
      symlinkSync(outside, runtime)
    }
    if (failure === "wrong-entry") {
      f.manifest.entries["@zavx0z/immersive"] = "chunks/runtime.js"
      f.saveManifest()
    }
    const reply = await run(f)
    expect(reply.ok).toBe(false)
    expect(reply.message).toBeTruthy()
    expect(existsSync(join(f.root, "kernel"))).toBe(false)
    expect(existsSync(f.stagingDirectory)).toBe(false)
  } finally { f.dispose() }
})

test.each(["../escape.js", "/absolute.js", "chunks\\runtime.js", "chunks/./runtime.js"])("готовый manifest отклоняет путь %s", async path => {
  const f = readyFixture()
  try {
    f.manifest.files[0]!.path = path
    f.saveManifest()
    const reply = await run(f)
    expect(reply.ok).toBe(false)
    expect(reply.message).toContain("Недопустимый файл")
    expect(existsSync(join(f.root, "kernel"))).toBe(false)
    expect(existsSync(f.stagingDirectory)).toBe(false)
  } finally { f.dispose() }
})

test.each(["duplicate-file", "bad-digest", "empty-files", "schema", "owner"])("готовый manifest отклоняет %s", async failure => {
  const f = readyFixture()
  try {
    if (failure === "duplicate-file") f.manifest.files.push({...f.manifest.files[0]!})
    if (failure === "bad-digest") f.manifest.files[0]!.digest = "invalid"
    if (failure === "empty-files") f.manifest.files = []
    if (failure === "schema") f.manifest.schemaVersion = 2
    if (failure === "owner") f.manifest.name = "@foreign/owner"
    f.saveManifest()
    const reply = await run(f)
    expect(reply.ok).toBe(false)
    expect(reply.message).toBeTruthy()
    expect(existsSync(join(f.root, "kernel"))).toBe(false)
    expect(existsSync(f.stagingDirectory)).toBe(false)
  } finally { f.dispose() }
})

test("архив проверяет каждый chunk и отвергает изменённый опубликованный файл", async () => {
  const f = readyFixture()
  try {
    const reply = await run(f, "corrupt")
    expect(reply.ok, reply.message).toBe(true)
    expect(reply.archiveError).toContain("Повреждён артефакт")
    expect(reply.collisionError).toContain("Immutable shared artifact collision")
    const runtime = reply.result.artifacts.find(artifact => artifact.path.endsWith("/chunks/runtime.js"))!
    expect(hash(reply.contents)).not.toBe(runtime.digest)
    expect(existsSync(f.stagingDirectory)).toBe(false)
  } finally { f.dispose() }
})


test("sourceExports сохраняет manifest digest, точные owner URLs и архив без исходников или компиляции", async () => {
  const f = readyFixture()
  try {
    const provenance = f.addSourceExport()
    const reply = await run(f, "runtime")
    expect(reply.ok, reply.message).toBe(true)
    expect(reply.compilations).toBe(0)
    const module = reply.result.identity.modules.find(module => module.specifier === "@zavx0z/immersive")!
    const artifact = reply.result.artifacts.find(artifact => artifact.path.endsWith(`/${provenance.file}`))!
    const source = module.sources![0]!
    expect(source).toEqual({
      specifier: provenance.specifier,
      sourcePath: join(f.owner, provenance.source),
      manifestPath: join(f.owner, provenance.manifest),
      manifestDigest: provenance.digest,
      url: `/__storybook/shared/${artifact.path}`,
    })
    expect(source.url).not.toBe(module.url)
    expect(readFileSync(join(f.root, artifact.path), "utf8")).toBe(f.contents[provenance.file]!)
    expect(reply.sameSourceRuntime).toBe(true)
    expect(reply.archived).toEqual(reply.result)
    expect(reply.repeated).toEqual(reply.result)
    expect(existsSync(f.owner)).toBe(false)
    expect(existsSync(f.stagingDirectory)).toBe(false)
  } finally { f.dispose() }
})

test.each(["source-path", "manifest-path", "digest", "missing-owner-entry"])("sourceExports отклоняет %s до публикации", async failure => {
  const f = readyFixture()
  try {
    const source = f.addSourceExport()
    if (failure === "source-path") source.source = "../outside.ts"
    if (failure === "manifest-path") source.manifest = "/outside/package.json"
    if (failure === "digest") source.digest = "bad-digest"
    if (failure === "missing-owner-entry") source.file = "missing.js"
    f.saveManifest()
    const reply = await run(f)
    expect(reply.ok).toBe(false)
    expect(reply.message).toBeTruthy()
    expect(reply.compilations).toBe(0)
    expect(existsSync(join(f.root, "kernel"))).toBe(false)
    expect(existsSync(f.stagingDirectory)).toBe(false)
  } finally { f.dispose() }
})


test("архив provenance требует attested artifact каждого source URL, включая private owner entry", async () => {
  const f = readyFixture()
  try {
    f.addSourceExport()
    const reply = await run(f, "source-artifact")
    expect(reply.ok, reply.message).toBe(true)
    expect(reply.missingSourceError).toBeTruthy()
    expect(reply.compilations).toBe(0)
  } finally { f.dispose() }
})
