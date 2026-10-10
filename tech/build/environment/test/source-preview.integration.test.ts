import {expect, test} from "bun:test"
import {mkdtemp, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import {pathToFileURL} from "node:url"
import Compiler from "@zavx0z/storybook-tech-build-compiler"
import Environment from "@zavx0z/storybook-tech-build-environment"

test("исходный CycleField использует hooks и DOM одной готовой платформы", async () => {
  const toolRoot = resolve(import.meta.dir, "../../../..")
  const repo = await realpath(resolve(import.meta.dir, "../../../../../immersive"))
  const packageRoot = join(repo, "ui/component/field/cycle")
  const source = join(packageRoot, "index.tsx")
  const directory = await mkdtemp(join(tmpdir(), "storybook-source-preview-"))
  try {
    const published = join(directory, "published")
    const {identity} = await Environment.build({toolRoot, root: published, stagingDirectory: join(directory, "staging")})
    const plugins = await Compiler.createStorybookPackageCompilerPlugins({toolRoot, repo, packageRoot, moduleSourcePaths: [source]})
    const entry = join(directory, "preview.ts")
    await Bun.write(entry, `
import CycleField from ${JSON.stringify(source)}
import {createDocument} from "@zavx0z/immersive"
import {createRoot} from "@zavx0z/immersive/XReact"
export function verify() {
  const document = createDocument()
  const host = document.createElement("div")
  document.append(host)
  const root = createRoot(host)
  const options = [{key: "a", value: "a", label: "Первый"}, {key: "b", value: "b", label: "Второй"}]
  try {
    root.render(CycleField, {value: "a", options})
    const button = host.querySelector("button")!
    if (!button.textContent.includes("Первый")) throw new Error("Source CycleField did not mount with ready hooks")
    root.render(CycleField, {value: "b", options})
    root.flush()
    if (host.querySelector("button") !== button) throw new Error("Source CycleField replaced its semantic button")
    if (!button.textContent.includes("Второй")) throw new Error("Source CycleField did not update its prepared child")
  } finally { root.unmount() }
}
`)
    const result = await Bun.build({entrypoints: [entry], target: "browser", metafile: true, plugins: [
      Environment.externalPlugin(identity, {moduleSourcePaths: [source]}), ...plugins,
    ], throw: false})
    expect(result.success, result.logs.map(log => log.message).join("\n")).toBeTrue()
    const inputs = Object.keys(result.metafile!.inputs).join("\n")
    expect(inputs).toContain("ui/component/field/cycle/index.tsx")
    expect(inputs).not.toContain("component/src/runtime.ts")
    expect(inputs).not.toContain("dom/src/document.ts")
    expect(inputs).not.toContain("template/compiled.ts")
    let code = await result.outputs[0]!.text()
    const component = identity.modules.flatMap(module => module.sources ?? []).find(source => source.specifier === "@zavx0z/immersive-component")!
    expect(code).toContain(component.url)
    for (const module of identity.modules) {
      for (const url of [module.url, ...(module.sources ?? []).map(source => source.url)]) {
        code = code.replaceAll(JSON.stringify(url), JSON.stringify(pathToFileURL(join(published, url.slice("/__storybook/shared/".length))).href))
      }
    }
    const output = join(directory, "preview.js")
    await Bun.write(output, code)
    const runner = join(directory, "verify.ts")
    await Bun.write(runner, 'import {verify} from "./preview.js"\nverify()\n')
    const child = Bun.spawn([process.execPath, runner], {cwd: directory, stdout: "pipe", stderr: "pipe"})
    const [status, errors] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(status, errors).toBe(0)
  } finally { await rm(directory, {recursive: true, force: true}) }
}, 120_000)
