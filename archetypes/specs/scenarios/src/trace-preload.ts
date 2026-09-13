/**
Собирает модули трассировки в дочернем Bun: plugin, preload владельца, наблюдатели и завершение IPC.

@packageDocumentation
*/
import {resolve} from "node:path"
import * as bunTest from "bun:test"
import {runtime} from "./context"
import {instrument} from "./instrument"
import {observe} from "./observe"
import {drain} from "./pending"
import type {discover} from "./discover"

type Registrar = (...args: unknown[]) => unknown
Reflect.set(globalThis, Symbol.for("storybook.trace"), runtime)

const encodedConfig = process.env.STORYBOOK_TRACE_CONFIG
if (!encodedConfig) throw new Error("Не задан список наблюдаемых exports")
const configuration = JSON.parse(Buffer.from(encodedConfig, "base64url").toString()) as Awaited<ReturnType<typeof discover>>
const scenarioPath = resolve(configuration.path)

Bun.plugin({
  name: "storybook-scenario-trace",
  setup(build) {
    const escapedPath = scenarioPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    build.onLoad({filter: new RegExp(`^${escapedPath}$`)}, async ({path}) => {
      const source = await Bun.file(path).text()
      const pragma = configuration.jsxImportSource ? `/** @jsxImportSource ${configuration.jsxImportSource} */` : ""
      return {contents: pragma + await instrument(path, source), loader: path.endsWith("x") ? "tsx" : "ts"}
    })
  },
})

for (const preload of configuration.preload ?? []) await import(preload)

for (const selection of configuration.observe) {
  const module = selection.module.startsWith(".") ? resolve(selection.module) : selection.module
  const imported = await import(module) as Record<string, unknown>
  const replacement: Record<string, unknown> = {...imported}
  for (const name of Object.keys(imported)) {
    const original = imported[name]
    if (typeof original !== "function") continue
    replacement[name] = observe(selection.module, name, original as Registrar)
  }
  await bunTest.mock.module(module, () => replacement)
}

bunTest.afterAll(async () => {
  await drain()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Не получен IPC ack")), 5_000)
    process.once("message", message => {
      if (typeof message === "object" && message !== null && Reflect.get(message, "type") === "storybook:trace-ack") {
        clearTimeout(timeout)
        resolve()
      }
    })
    process.send?.({type: "storybook:trace-complete"})
  })
})
