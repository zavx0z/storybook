/**
Собирает модули трассировки в дочернем Bun: plugin, preload владельца, наблюдатели и завершение IPC.

@packageDocumentation
*/
import {dirname, resolve} from "node:path"
import {existsSync} from "node:fs"
import * as bunTest from "bun:test"
import Compiler from "@zavx0z/storybook-tech-build-compiler"
import {runtime, setRunProps} from "./context"
import {instrument} from "./instrument"
import {observe} from "./observe"
import {drain} from "./pending"
import {readAssertions} from "./assertions"
import {readRecords} from "./records"
import {registerCompiledSource} from "./source-location"
import type {discover} from "./discover"

type Registrar = (...args: unknown[]) => unknown
Reflect.set(globalThis, Symbol.for("storybook.trace"), runtime)

const {configuration, props, variant, variantPath} = JSON.parse(await Bun.stdin.text()) as {
  configuration: Awaited<ReturnType<typeof discover>>
  props?: Readonly<Record<string, unknown>>
  variant?: number
  variantPath?: readonly number[]
}
setRunProps(props, variant, variantPath)
const scenarioPath = resolve(configuration.path)

if (configuration.jsxImportSource !== undefined) {
  let repo = configuration.cwd
  while (!existsSync(resolve(repo, ".git"))) {
    const parent = dirname(repo)
    if (parent === repo) throw new Error(`Не найден Repo сценария: ${scenarioPath}`)
    repo = parent
  }
  const ownerSourcePath = Compiler.createStorybookOwnerSourcePath({repo, packageRoot: configuration.cwd})
  const sourcePath = ownerSourcePath(scenarioPath)
  let transformed = false
  const plugins = await Compiler.createStorybookPackageCompilerPlugins({
    toolRoot: resolve(import.meta.dir, "../../../.."),
    packageRoot: configuration.cwd,
    repo,
    moduleSourcePaths: [sourcePath],
    persistent: true,
    sourceTransform: async (path, source) => {
      if (path !== sourcePath) throw new Error(`Trace compiler вышел за выбранный сценарий: ${path}`)
      transformed = true
      return instrument(path, source)
    },
    onCompiled: (path, source, result) => {
      if (!Array.isArray(result.sourceRanges)) throw new Error("Trace требует compiler sourceRanges")
      registerCompiledSource(path, source, result.code, result.sourceRanges)
      if (path !== scenarioPath) registerCompiledSource(scenarioPath, source, result.code, result.sourceRanges, path)
    },
  })
  // Первый onLoad завершает pipeline Bun: instrumentation и JSX принадлежат
  // одной обработке оригинального файла, а остальные модули — preload владельца.
  for (const plugin of plugins) Bun.plugin({
    name: `storybook-trace-${plugin.name}`,
    setup(build) {
      plugin.setup({
        ...build,
        onLoad(options, callback) {
          if (!options.filter.test(sourcePath)) throw new Error(`Сценарий вне native compiler filter: ${sourcePath}`)
          const paths = [...new Set([scenarioPath, sourcePath])].map(path => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          return build.onLoad({...options, filter: new RegExp(`^(?:${paths.join("|")})$`)}, async arguments_ => {
            transformed = false
            const result = await callback({...arguments_, path: sourcePath})
            if (!transformed) throw new Error("Trace требует compiler sourceTransform")
            return result
          })
        },
      })
    },
  })
} else Bun.plugin({
  name: "storybook-scenario-trace",
  setup(build) {
    const escapedPath = scenarioPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    build.onLoad({filter: new RegExp(`^${escapedPath}$`)}, async ({path}) => ({
      contents: await instrument(path, await Bun.file(path).text()),
      loader: path.endsWith("x") ? "tsx" : "ts",
    }))
  },
})

for (const preload of configuration.preload ?? []) await import(preload)

for (const selection of configuration.observe) {
  const module = selection.module.startsWith(".") ? resolve(selection.module) : selection.module
  const imported = await import(module) as Record<string, unknown>
  const replacement: Record<string, unknown> = {...imported}
  for (const name of selection.names ?? Object.keys(imported)) {
    const original = imported[name]
    if (typeof original !== "function") continue
    replacement[name] = observe(selection.module, name, original as Registrar)
  }
  await bunTest.mock.module(module, () => replacement)
}

bunTest.afterAll(async () => {
  await drain()
  process.send?.({type: "storybook:assertions", assertions: await readAssertions()})
  process.send?.({type: "storybook:records", ...await readRecords()})
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      process.removeListener("message", onMessage)
      process.removeListener("disconnect", onDisconnect)
    }
    const onMessage = (message: unknown) => {
      if (typeof message !== "object" || message === null || Reflect.get(message, "type") !== "storybook:trace-ack") return
      cleanup()
      resolve()
    }
    const onDisconnect = () => {
      cleanup()
      reject(new Error("IPC соединение закрыто до подтверждения отчёта"))
    }
    process.on("message", onMessage)
    process.once("disconnect", onDisconnect)
    if (!process.connected || process.send === undefined) onDisconnect()
    else process.send({type: "storybook:trace-complete"})
  })
})
