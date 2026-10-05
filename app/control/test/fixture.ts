import type {StorybookAppControl} from "../index"

type Controller = Awaited<ReturnType<StorybookAppControl.Input["controller"]>>
type Context = Parameters<Controller["check"]>[1]

/** Контроллер фиксирует переданные входы; его ответы независимы от схем и транспорта. */
export function fixture(check?: Controller["check"]) {
  const calls: {method: string, input: unknown, context: Context}[] = []
  const record = async (method: string, input: unknown, context: Context) => {
    calls.push({method, input, context})
    return {status: "success" as const, method, input}
  }
  const controller: Controller = {
    ensure: (input, context) => record("ensure", input, context),
    status: (input, context) => record("status", input, context),
    attach: (input, context) => record("attach", input, context),
    detach: (input, context) => record("detach", input, context),
    search: (input, context) => record("search", input, context),
    open: (input, context) => record("open", input, context),
    wait: (input, context) => record("wait", input, context),
    inspect: (input, context) => record("inspect", input, context),
    interact: (input, context) => record("interact", input, context),
    capture: async (input, context) => ({...await record("capture", input, context), image: {mimeType: "image/png", data: "UE5H"}}),
    check: check ?? ((input, context) => record("check", input, context)),
    close: (input, context) => record("close", input, context),
    stop: (input, context) => record("stop", input, context),
    readResource: async (uri, context) => ({...await record("readResource", uri, context), uri, mimeType: "application/json", text: '{"resource":true}'}),
  }
  return {controller, calls}
}
