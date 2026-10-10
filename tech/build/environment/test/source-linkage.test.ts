import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdir, mkdtemp, readFile, rm, symlink} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import Environment from "@zavx0z/storybook-tech-build-environment"

test("source export связывается с exact ready URL после проверки actual owner", async () => {
  const fixture = await sourceFixture()
  try {
    const result = await fixture.build()
    expect(result.success, result.logs.map(log => log.message).join("\n")).toBeTrue()
    expect(await result.outputs[0]!.text()).toContain(fixture.sourceUrl)
    expect(Object.keys(result.metafile!.inputs)).toHaveLength(1)
  } finally { await fixture.dispose() }
})

test("source linkage отклоняет чужой одноимённый package owner", async () => {
  const fixture = await sourceFixture(true)
  try {
    const result = await fixture.build()
    expect(result.success).toBeFalse()
    expect(result.logs.map(log => log.message).join("\n")).toContain("different package identity")
  } finally { await fixture.dispose() }
})

test("source linkage проверяет manifest digest и exact exported file", async () => {
  const fixture = await sourceFixture()
  try {
    const original = await readFile(fixture.manifest, "utf8")
    await Bun.write(fixture.manifest, `${original}\n`)
    const changed = await fixture.build()
    expect(changed.success).toBeFalse()
    expect(changed.logs.map(log => log.message).join("\n")).toContain("manifest changed")
    await Bun.write(fixture.manifest, original)
    const other = join(fixture.owner, "other.ts")
    await Bun.write(other, 'export const value = "other-source"\n')
    const identity = Environment.identity("/__storybook/shared/entry.js", [{
      ...fixture.identity.modules[0]!,
      sources: [{...fixture.identity.modules[0]!.sources![0]!, sourcePath: other}],
    }], "a".repeat(64))
    const wrongFile = await fixture.build(identity)
    expect(wrongFile.success).toBeFalse()
    expect(wrongFile.logs.map(log => log.message).join("\n")).toContain("export changed identity")
  } finally { await fixture.dispose() }
})

test("запрошенный source module остаётся в компиляции своей preview", async () => {
  const fixture = await sourceFixture()
  try {
    const result = await fixture.build(fixture.identity, [fixture.source])
    expect(result.success, result.logs.map(log => log.message).join("\n")).toBeTrue()
    expect(await result.outputs[0]!.text()).toContain("authored-source")
    expect(await result.outputs[0]!.text()).not.toContain(fixture.sourceUrl)
    expect(Object.keys(result.metafile!.inputs).some(path => path.endsWith("owner/index.ts"))).toBeTrue()
  } finally { await fixture.dispose() }
})

async function sourceFixture(foreign = false) {
  const root = await mkdtemp(join(tmpdir(), "storybook-source-linkage-"))
  const owner = join(root, "owner")
  const consumer = join(root, "consumer")
  const manifest = join(owner, "package.json")
  const source = join(owner, "index.ts")
  const entry = join(consumer, "index.ts")
  const sourceUrl = "/__storybook/shared/platform/owner/index.js"
  await Bun.write(manifest, JSON.stringify({name: "@fixture/runtime", type: "module", exports: {".": "./index.ts"}}))
  await Bun.write(source, 'export const value = "authored-source"\n')
  await Bun.write(join(consumer, "package.json"), JSON.stringify({name: "@fixture/preview", type: "module"}))
  await Bun.write(entry, 'export {value} from "@fixture/runtime"\n')
  let installed = owner
  if (foreign) {
    installed = join(root, "foreign")
    await Bun.write(join(installed, "package.json"), await readFile(manifest))
    await Bun.write(join(installed, "index.ts"), await readFile(source))
  }
  await mkdir(join(consumer, "node_modules/@fixture"), {recursive: true})
  await symlink(installed, join(consumer, "node_modules/@fixture/runtime"))
  const identity = Environment.identity("/__storybook/shared/entry.js", [{
    specifier: "@fixture/public", sourcePath: join(root, "ready/facade.js"),
    url: "/__storybook/shared/platform/facade.js",
    sources: [{specifier: "@fixture/runtime", sourcePath: source, manifestPath: manifest,
      manifestDigest: createHash("sha256").update(await readFile(manifest)).digest("hex"), url: sourceUrl}],
  }], "a".repeat(64))
  return {
    owner, manifest, source, sourceUrl, identity,
    build(snapshot = identity, moduleSourcePaths: readonly string[] = []) {
      return Bun.build({entrypoints: [entry], target: "browser", metafile: true,
        plugins: [Environment.externalPlugin(snapshot, {moduleSourcePaths})], throw: false})
    },
    dispose() { return rm(root, {recursive: true, force: true}) },
  }
}
