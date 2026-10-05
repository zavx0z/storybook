import {expect, test} from "bun:test"
import createControl from "../index"
import {fixture} from "./fixture"

test("описания готовятся без запуска контроллера и не обещают lifecycle остановленного endpoint", async () => {
  let loads = 0
  const f = fixture()
  const control = createControl({controller: () => { loads += 1; return f.controller }})
  expect(loads).toBe(0)
  expect(control.tools.map(tool => tool.name)).toEqual([
    "storybook_status", "storybook_search", "storybook_open", "storybook_wait", "storybook_inspect",
    "storybook_interact", "storybook_capture", "storybook_check", "storybook_close", "storybook_rebuild_web", "storybook_read_resource",
  ])
  await control.tools.find(tool => tool.name === "storybook_status")!.execute({schemaVersion: 1})
  expect(loads).toBe(1)
  expect(f.calls.map(call => call.method)).toEqual(["status"])
})

test("каталог команд использует строгие Zod refine до любого dispatch", async () => {
  const f = fixture()
  const control = createControl({controller: () => f.controller, lifecycle: true, resources: false})
  expect(control.tools).toHaveLength(14)
  for (const command of [
    {name: "storybook_status", arguments: {schemaVersion: 1, unexpected: true}},
    {name: "storybook_wait", arguments: {schemaVersion: 1, viewId: `storybook-view-v1_${"a".repeat(43)}`, condition: "built"}},
    {name: "storybook_interact", arguments: {schemaVersion: 1, viewId: `storybook-view-v1_${"a".repeat(43)}`, action: "click"}},
    {name: "storybook_capture", arguments: {schemaVersion: 1, packageId: "@sample/a", area: "node"}},
    {name: "storybook_stop", arguments: {schemaVersion: 1, confirm: false}},
  ]) {
    expect(control.schemas[command.name]!.safeParse(command.arguments).success).toBeFalse()
    await expect(control.tools.find(tool => tool.name === command.name)!.execute(command.arguments)).rejects.toMatchObject({code: "INVALID_INPUT"})
  }
  expect(f.calls).toEqual([])
})

test("исполнители сохраняют реальные аргументы, image и resource результата общего контроллера", async () => {
  const f = fixture()
  const control = createControl({controller: () => f.controller})
  const inspect = await control.tools.find(tool => tool.name === "storybook_inspect")!.execute({schemaVersion: 1, viewId: `storybook-view-v1_${"a".repeat(43)}`, include: ["canvas"]})
  expect(inspect).toMatchObject({method: "inspect", input: {include: ["canvas"]}})
  const capture = await control.tools.find(tool => tool.name === "storybook_capture")!.execute({schemaVersion: 1, packageId: "@sample/a", area: "preview"})
  expect(capture).toMatchObject({image: {mimeType: "image/png", data: "UE5H"}})
  const resource = await control.tools.find(tool => tool.name === "storybook_read_resource")!.execute({uri: "storybook://state"})
  expect(resource).toMatchObject({uri: "storybook://state", text: '{"resource":true}'})
  expect(f.calls.map(call => call.method)).toEqual(["inspect", "capture", "readResource"])
})

test("check и rebuild сохраняют общий context signal/progress и не вводят второй scheduler", async () => {
  const progress: Record<string, unknown>[] = []
  const scopes: string[] = []
  const abort = new AbortController()
  const f = fixture(async (input, context) => {
    expect(context.signal).toBe(abort.signal)
    scopes.push(input.scope)
    await context.onProgress?.({phase: "building", scope: input.scope})
    return {status: "success", scope: input.scope}
  })
  const control = createControl({controller: () => f.controller})
  const context = {signal: abort.signal, onProgress: (value: Readonly<Record<string, unknown>>) => { progress.push(value) }}
  await control.tools.find(tool => tool.name === "storybook_check")!.execute({schemaVersion: 1, scope: "@sample/a"}, context)
  await control.tools.find(tool => tool.name === "storybook_rebuild_web")!.execute({}, context)
  expect(scopes).toEqual(["@sample/a", "storybook:web"])
  expect(progress).toEqual([{phase: "building", scope: "@sample/a"}, {phase: "building", scope: "storybook:web"}])
  abort.abort()
  await expect(control.tools.find(tool => tool.name === "storybook_status")!.execute({schemaVersion: 1}, context)).rejects.toThrow()
  expect(f.calls).toEqual([])
})

test("общий владелец не зависит от App и не копирует его runtime", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json()
  expect(manifest.dependencies).not.toHaveProperty("@zavx0z/storybook-app")
  expect(manifest.dependencies).not.toHaveProperty("@zavx0z/storybook-app-server")
})

test("fill задаёт содержимое целиком и допускает очистку, type сохраняет непустой ввод", () => {
  const control = createControl({controller: () => fixture().controller})
  const input = {schemaVersion: 1, viewId: `storybook-view-v1_${"a".repeat(43)}`, target: {role: "textbox", name: "Черновик"}}
  const schema = control.schemas.storybook_interact!
  expect(schema.safeParse({...input, action: "fill", value: ""}).success).toBeTrue()
  expect(schema.safeParse({...input, action: "fill", value: {text: ""}}).success).toBeTrue()
  expect(schema.safeParse({...input, action: "fill", value: "a".repeat(4096)}).success).toBeTrue()
  expect(schema.safeParse({...input, action: "fill", value: "a".repeat(4097)}).success).toBeFalse()
  expect(schema.safeParse({...input, action: "fill", value: 1}).success).toBeFalse()
  expect(schema.safeParse({schemaVersion: 1, viewId: input.viewId, action: "fill", value: ""}).success).toBeFalse()
  expect(schema.safeParse({...input, action: "type", value: ""}).success).toBeFalse()
  expect(schema.safeParse({...input, action: "type", value: {text: ""}}).success).toBeFalse()
  expect(schema.safeParse({...input, action: "type", value: "a"}).success).toBeTrue()
})
