import {afterEach, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, normalize, resolve, sep} from "node:path"
import Artifacts from "@storybook-tech-build/artifacts"
const {emittedEntry} = Artifacts
import {sources} from "../src/sources"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

test("точные entryPoint сохраняют два index.ts и общий chunk после переноса артефактов", async () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-entry-mapping-"))
  roots.push(root)
  for (const directory of ["page", "package"]) mkdirSync(join(root, directory))
  writeFileSync(join(root, "shared.ts"), "export const value = {stable: true}\n")
  const page = join(root, "page/index.ts")
  const packageEntry = join(root, "package/index.ts")
  const source = 'export {value} from "../shared"\n'
  writeFileSync(page, source)
  writeFileSync(packageEntry, source)
  const staging = join(root, "staging")
  const result = await Artifacts.build(async () => ({
    entrypoints: [page, packageEntry],
    outdir: staging,
    naming: {entry: "[dir]/[name]-[hash].[ext]", chunk: "chunks/[name]-[hash].[ext]"},
    target: "browser",
    format: "esm",
    splitting: true,
    metafile: true,
  }))
  expect(result.success).toBeTrue()
  const entries = result.outputs.filter(artifact => artifact.kind === "entry-point")
  const chunks = result.outputs.filter(artifact => artifact.kind === "chunk")
  expect(entries).toHaveLength(2)
  expect(chunks).toHaveLength(1)
  const pageOutput = emittedEntry(result, staging, page)
  const packageOutput = emittedEntry(result, staging, packageEntry)
  expect(pageOutput).not.toBe(packageOutput)
  expect(pageOutput).toMatch(/\/page\/index-[^/]+\.js$/u)
  expect(packageOutput).toMatch(/\/package\/index-[^/]+\.js$/u)
  expect(result.outputs.some(artifact => artifact.path === join(staging, pageOutput))).toBeTrue()
  expect(result.outputs.some(artifact => artifact.path === join(staging, packageOutput))).toBeTrue()
  const outputs = result.metafile!.outputs
  for (const [entry, emitted] of [[page, pageOutput], [packageEntry, packageOutput]]) {
    const [outputPath, metadata] = Object.entries(outputs).find(([, value]) =>
      value.entryPoint !== undefined && realpathSync(resolve(value.entryPoint)) === realpathSync(entry!))!
    expect(emitted!.endsWith(`${sep}${normalize(outputPath)}`)).toBeTrue()
    expect(metadata.imports.some(item => Object.hasOwn(outputs, item.path) && outputs[item.path]!.entryPoint === undefined)).toBeTrue()
  }
  // Порядок artifacts не является соответствием source и output.
  expect(emittedEntry({...result, outputs: [...result.outputs].reverse()}, staging, packageEntry)).toBe(packageOutput)
  expect(() => emittedEntry(result, staging, join(root, "shared.ts"))).toThrow("not uniquely emitted")
})

test("отсутствующий metafile не подменяется похожим именем artifact", () => {
  const result = {outputs: [{kind: "entry-point", path: "/output/index-hash.js"}]} as Bun.BuildOutput
  expect(() => emittedEntry(result, "/output", "/source/index.ts")).toThrow("no shared browser metafile")
})

test("browser page entry предоставляет единственный default вход", async () => {
  const result = await Bun.build({
    entrypoints: [sources.pageEntry],
    target: "browser",
    format: "esm",
    plugins: [{
      name: "page-entry-test-double",
      setup(build) {
        build.onResolve({filter: /^@web\/page$/u}, () => ({path: "@storybook-app-web/page", namespace: "page-entry-test"}))
        build.onLoad({filter: /.*/u, namespace: "page-entry-test"}, () => ({
          contents: "const start = () => 'page-ready'\nexport default start",
          loader: "js",
        }))
      },
    }],
  })
  expect(result.success).toBeTrue()
  expect(result.outputs).toHaveLength(1)
  const emitted = await result.outputs[0]!.text()
  const module = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(emitted)}`)
  expect(typeof module.default).toBe("function")
  expect(Object.keys(module)).toEqual(["default"])
  expect(module.default()).toBe("page-ready")
})
