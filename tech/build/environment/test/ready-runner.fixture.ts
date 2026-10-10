import Environment from "@zavx0z/storybook-tech-build-environment"
import {readFileSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {pathToFileURL} from "node:url"
import type {PlatformBuildInput} from "../contract/build.ts"

// Отдельный процесс сохраняет настоящий resolver fixture, без глобального test-preload Storybook.
const request = JSON.parse(process.argv[2]!) as {input: PlatformBuildInput; action: "build" | "runtime" | "corrupt" | "source-artifact"; owner: string}
const phases: string[] = []
let compilations = 0
Bun.build = (() => {
  compilations++
  throw new Error("Готовый runtime запрещено компилировать повторно")
}) as typeof Bun.build
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
try {
  const result = await Environment.build(request.input, event => phases.push(`${event.phase}:${event.state}`))
  let details = {}
  if (request.action === "runtime") {
    const modules = new Map(result.identity.modules.map(module => [module.specifier, module]))
    const load = (specifier: string) => import(pathToFileURL(join(request.input.root, modules.get(specifier)!.url.slice("/__storybook/shared/".length))).href)
    const dom = await load("@zavx0z/immersive")
    const react = await load("@zavx0z/immersive/XReact")
    const jsx = await load("@zavx0z/immersive/XReact/jsx-runtime")
    const source = result.identity.modules.flatMap(module => module.sources ?? [])[0]
    const readySource = source === undefined ? null : await import(pathToFileURL(join(request.input.root, source.url.slice("/__storybook/shared/".length))).href)
    const repeated = await Environment.build(request.input)
    rmSync(request.owner, {recursive: true, force: true})
    details = {
      sameElement: react.Element === dom.Element,
      sameRegistry: react.registry === dom.registry,
      sameJsx: jsx.jsx === dom.Element,
      sameSourceRuntime: readySource?.Element === dom.Element && readySource?.registry === dom.registry,
      repeated, archived: Environment.validateArtifacts(request.input.root, result),
    }
  }
  if (request.action === "corrupt") {
    const runtime = result.artifacts.find(artifact => artifact.path.endsWith("/chunks/runtime.js"))!
    writeFileSync(join(request.input.root, runtime.path), "export const corrupt = true\n")
    let archiveError = "", collisionError = ""
    try { Environment.validateArtifacts(request.input.root, result) } catch (error) { archiveError = message(error) }
    try { await Environment.build(request.input) } catch (error) { collisionError = message(error) }
    details = {archiveError, collisionError, contents: readFileSync(join(request.input.root, runtime.path), "utf8")}
  }
  if (request.action === "source-artifact") {
    const source = result.identity.modules.flatMap(module => module.sources ?? [])[0]!
    const ownerFile = source.url.slice("/__storybook/shared/".length)
    const artifacts = result.artifacts.filter(artifact => artifact.path !== ownerFile)
    let missingSourceError = ""
    try { Environment.validateArtifacts(request.input.root, {...result, artifacts}) } catch (error) { missingSourceError = message(error) }
    details = {missingSourceError}
  }
  console.log(JSON.stringify({ok: true, result, phases, compilations, ...details}))
} catch (error) {
  console.log(JSON.stringify({ok: false, message: message(error), phases, compilations}))
}
