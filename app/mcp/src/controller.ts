import type {StorybookControllerAccessor} from "./resources"
import type {StorybookAppMcp} from "../contract"
import type {Controller} from "../contract/types"
import {recordMcpRequest, traceMcpRequest} from "./request-log"

export function controllerAccessor(
  options: StorybookAppMcp.Input,
  run: <Result>(operation: () => Promise<Result>) => Promise<Result> = operation => operation(),
): StorybookControllerAccessor {
  let pending: Promise<Controller> | null = null
  return () => {
    pending ??= Promise.resolve(options.controller ?? options.controllerFactory?.() ??
      Promise.reject(new Error("App must supply a Storybook controller to MCP")))
      .then(validateController)
      .then(controller => new Proxy(controller, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver)
          if (typeof value !== "function" || typeof key !== "string") return value
          return (...args: unknown[]) => run(() => traceMcpRequest(`storybook_${key}`, args[0],
            () => value.apply(target, args), options.recordRequest ?? recordMcpRequest))
        },
      }))
      .catch((error) => {
        pending = null
        throw error
      })
    return pending
  }
}

function validateController(value: unknown): Controller {
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
  return value as Controller
}
