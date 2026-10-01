import {type StorybookApp as StorybookAppContract} from "@storybook/app"
import type {StorybookControllerAccessor} from "./resources"
import type {CreateStorybookMcpServerInput} from "../contract/input"
import {recordMcpRequest, traceMcpRequest} from "./request-log"

export function controllerAccessor(options: CreateStorybookMcpServerInput): StorybookControllerAccessor {
  let pending: Promise<StorybookAppContract.Output> | null = null
  return () => {
    pending ??= Promise.resolve(options.controller ?? options.controllerFactory?.() ?? loadCanonicalController())
      .then(validateController)
      .then(controller => new Proxy(controller, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver)
          if (typeof value !== "function" || typeof key !== "string") return value
          return (...args: unknown[]) => traceMcpRequest(`storybook_${key}`, args[0],
            () => value.apply(target, args), options.recordRequest ?? recordMcpRequest)
        },
      }))
      .catch((error) => {
        pending = null
        throw error
      })
    return pending
  }
}

async function loadCanonicalController(): Promise<StorybookAppContract.Output> {
  const moduleUrl = new URL("../../../index.ts", import.meta.url)
  const namespace = await import(moduleUrl.href) as Record<string, unknown>
  const factory = namespace.default
  if (typeof factory !== "function") {
    throw new Error("Canonical Storybook app does not export its launcher")
  }
  return validateController(await factory())
}

function validateController(value: unknown): StorybookAppContract.Output {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External Storybook controller must be an object")
  }
  const controller = value as Record<string, unknown>
  for (const method of [
    "ensure",
    "status",
    "attach",
    "detach",
    "search",
    "open",
    "wait",
    "inspect",
    "interact",
    "capture",
    "check",
    "close",
    "stop",
    "readResource",
  ]) {
    if (typeof controller[method] !== "function") throw new Error(`External Storybook controller is missing ${method}()`)
  }
  return value as StorybookAppContract.Output
}
