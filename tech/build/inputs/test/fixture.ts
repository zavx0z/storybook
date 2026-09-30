import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import type {BuildInputPlanInput} from "@build/inputs"

/** Создаёт независимые exact inputs вне checkout; dispose удаляет только этот временный root. */
export function createFixture(identity: unknown = {owner: "isolated-build"}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "build-inputs-")))
  const root = join(directory, "owner")
  const compiler = join(root, "compiler")
  const external = join(directory, "node_modules", "dependency")
  const outsideRoot = join(directory, "outside")
  const state = join(root, ".idea")
  for (const path of [root, compiler, external, outsideRoot, state]) mkdirSync(path, {recursive: true})
  const source = join(root, "entry.ts")
  const sourceText = "export const value = 1\n"
  const adapter = join(compiler, "adapter.ts")
  const toolchain = join(external, "compiler.js")
  const dependency = join(external, "dependency.ts")
  const outside = join(outsideRoot, "escaped.ts")
  const workspace = join(state, "workspace.xml")
  writeFileSync(source, sourceText)
  writeFileSync(adapter, "export const compile = true\n")
  writeFileSync(toolchain, "export const compiler = true\n")
  writeFileSync(dependency, "export const dependency = true\n")
  writeFileSync(join(external, "package.json"), '{"name":"dependency"}\n')
  writeFileSync(join(root, "package.json"), '{"name":"isolated-owner"}\n')
  writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{}}\n')
  writeFileSync(outside, "export const escaped = true\n")
  writeFileSync(workspace, "<project />\n")
  const input: BuildInputPlanInput = {
    identity,
    roots: [root],
    guardRoots: [join(directory, "node_modules")],
    compilerRoots: [root],
    files: [source],
    compilerAdapterPath: adapter,
    toolchainFiles: [toolchain],
    validationAbi: {target: "browser", sourcemap: "external"},
    excludedRoots: [join(root, ".candidate-output")],
  }
  return {
    directory,
    root,
    compiler,
    external,
    source,
    sourceText,
    adapter,
    toolchain,
    dependency,
    outside,
    workspace,
    state,
    input,
    /** Идемпотентно удаляет изолированную среду этого примера. */
    dispose(): void { rmSync(directory, {recursive: true, force: true}) },
  }
}
