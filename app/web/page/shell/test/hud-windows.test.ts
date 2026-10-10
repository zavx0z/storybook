import {expect, test} from "bun:test"
import {InputEvent, MouseEvent, type HTMLElement, type HTMLInputElement} from "@zavx0z/immersive"
import {hitTestProjection} from "@zavx0z/immersive/renderer/html"
import type {StorybookAppProps} from "../src/application-props"
import {createWorkbenchModel} from "../workbench/src/model"
import {command} from "../mcp-window/spec/fixture/records"
import {createHudHost} from "./fixture/hud-host"

/** Настоящая HUD-композиция использует один Document, штатные окна и общую модель каталога. */
async function mount() {
  const owner = createHudHost()
  const model = createWorkbenchModel({document: owner.document, initial: {projectName: "Проект"}})
  const workbench = {getSnapshot: model.getSnapshot, subscribe: model.subscribe}
  const configured = {projectsDirectory: "/projects", repositoriesDirectory: "/repos"}
  const viewPointState = {ready: true, frozen: false}
  const application: StorybookAppProps = {
    title: "Storybook",
    statusOwner: "Проект",
    displayId: "display",
    hudId: "hud",
    onReady() {},
    directorySettingsClient: {read: async () => configured, save: async () => configured},
    executionWindowState: {open: true, geometry: {x: 0, y: 0, width: 1000, height: 800}},
    mcpWindowState: {open: true, mode: "agent", geometry: {x: 0, y: 0, width: 1000, height: 800}},
    minimapState: {collapsed: false, geometry: {x: 0, y: 0, width: 1000, height: 800}},
    loadMcpRequests: async () => [command("готово")],
    followEnvironment: {getSnapshot: () => false, subscribe: () => () => {}, toggle() {}},
    viewPointControls: {
      initialPosition: {edge: "bottom", offset: .5},
      getSnapshot: () => viewPointState,
      subscribe: () => () => {},
      savePosition() {}, restoreCamera() {}, bind() {}, toggleFrozen() {}, zoom() {}, fit() {}, dispose() {},
    },
  }
  const host = owner.render(application, workbench)
  await host.settle()
  await host.settle()
  const windows = [...host.container.querySelectorAll("[data-window]")] as HTMLElement[]
  const settings = host.container.querySelector('[id="storybook-execution-settings"]')! as HTMLElement
  const minimap = windows.find(window => window.getAttribute("aria-label") === "Проект")!
  const mcp = host.container.querySelector('[id="storybook-global-mcp-window"]')! as HTMLElement
  const active = () => host.container.querySelector('[data-window-active="true"]')
  return {...host, windows, settings, minimap, mcp, active,
    dispose() {
      host.dispose()
      model.dispose()
    },
  }
}

const click = (element: HTMLElement) => element.dispatchEvent(new MouseEvent("click", {bubbles: true}))

test("три окна HUD имеют общего родителя и A→B→A меняет активность, paint и hit order", async () => {
  const host = await mount()
  try {
    const layer = host.container.querySelector("[data-storybook-hud-windows]")!
    expect(host.windows).toHaveLength(3)
    expect([...layer.querySelectorAll("[data-window-area]")].every(area => area.parentElement === layer)).toBeTrue()
    expect(host.windows.every(window => window.ownerDocument === host.document && window.closest("hud")?.id === "hud")).toBeTrue()
    const initialFrame = host.renderer.flush()
    const blur = initialFrame.displayList.filter(item => item.kind === "rect" && item.backdropBlur !== undefined)
    expect(blur).toHaveLength(3)
    expect(blur.every(item => item.kind === "rect" && item.backdropBlur === 8 && host.windows.includes(item.node as HTMLElement))).toBeTrue()
    const field = host.settings.querySelector("input")! as HTMLInputElement
    const search = host.minimap.querySelector("input")! as HTMLInputElement
    for (const target of [field, search, field]) {
      target.focus()
      const frame = await host.settle()
      const selected = target.closest("[data-window]")!
      expect(host.active()).toBe(selected)
      expect(hitTestProjection(frame, 400, 300)?.node.closest("[data-window]")).toBe(selected)
      const paint = host.windows.map(window => frame.displayList.findLastIndex(item => item.node === window.querySelector("[data-window-chrome]")))
      expect(paint[host.windows.indexOf(selected as HTMLElement)]).toBe(Math.max(...paint))
    }
    const frame = host.renderer.flush()
    const viewpoint = host.button("Вписать в область просмотра")
    const bounds = host.bounds(viewpoint)
    expect(hitTestProjection(frame, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.node.closest("button")).toBe(viewpoint)
  } finally {host.dispose()}
})

test("сворачивание сохраняет черновик и focused field; dock доступен поверх остальных окон", async () => {
  const host = await mount()
  try {
    const field = host.settings.querySelector("input")! as HTMLInputElement
    field.focus()
    field.value = "/draft/projects"
    field.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "/draft/projects"}))
    field.setSelectionRange(2, 7)
    await host.settle()
    const minimize = host.button("Скрыть Настройки")
    minimize.focus()
    click(minimize)
    let frame = await host.settle()
    expect(host.settings.hasAttribute("hidden")).toBeTrue()
    host.mcp.focus()
    await host.settle()
    host.minimap.focus()
    frame = await host.settle()
    const dock = host.button("Настройки")
    const box = host.bounds(dock)
    const point = {clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerId: 11, button: 0}
    expect(hitTestProjection(frame, point.clientX, point.clientY)?.node.closest("button")).toBe(dock)
    host.input.pointerDown(frame, point)
    host.input.pointerUp(host.renderer.flush(), point)
    await host.settle()
    expect(host.settings.hasAttribute("hidden")).toBeFalse()
    expect(host.settings.querySelector("input")).toBe(field)
    expect([field.value, field.selectionStart, field.selectionEnd]).toEqual(["/draft/projects", 2, 7])
    expect(host.document.activeElement).toBe(field)
    expect(host.active()).toBe(host.settings)
    expect(host.windows.every(window => window.ownerDocument === host.document)).toBeTrue()
  } finally {host.dispose()}
})

const performanceOutput = process.env.WINDOW_INTEGRATION_PERF_OUTPUT
if (performanceOutput) test("измерения CPU композиции и ввода HUD", async () => {
  const initial: number[] = []
  const activity: number[] = []
  const minimizeRestore: number[] = []
  const samples = 20
  const warmup = 4
  for (let index = -warmup; index < samples; index++) {
    const start = performance.now()
    const host = await mount()
    const mounted = performance.now() - start
    try {
      const field = host.settings.querySelector("input")! as HTMLInputElement
      const search = host.minimap.querySelector("input")! as HTMLInputElement
      const activityStart = performance.now()
      for (const target of [field, search, field]) {
        target.focus()
        await host.settle()
      }
      const activityDuration = performance.now() - activityStart
      const minimizeStart = performance.now()
      click(host.button("Скрыть Настройки"))
      const frame = await host.settle()
      const dock = host.button("Настройки")
      const bounds = host.bounds(dock)
      const point = {clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2, pointerId: 12, button: 0}
      host.input.pointerDown(frame, point)
      host.input.pointerUp(host.renderer.flush(), point)
      await host.settle()
      const minimizeDuration = performance.now() - minimizeStart
      expect(host.document.activeElement).toBe(field)
      if (index >= 0) {
        initial.push(mounted)
        activity.push(activityDuration)
        minimizeRestore.push(minimizeDuration)
      }
    } finally {host.dispose()}
  }
  const metric = (rawMs: readonly number[]) => {
    const sorted = [...rawMs].sort((left, right) => left - right)
    return {rawMs, medianMs: (sorted[9]! + sorted[10]!) / 2, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1]!}
  }
  await Bun.write(performanceOutput, JSON.stringify({
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    samples,
    warmup,
    viewport: {width: 1000, height: 800},
    metrics: {
      initialRenderElapsed: metric(initial),
      activityAtoBtoAElapsed: metric(activity),
      minimizeRestoreWithPointerElapsed: metric(minimizeRestore),
    },
    baseline: {comparable: false, reason: "Предыдущая композиция трёх HUD Window имеет разных родителей и несовместима с общим Window activity layer"},
    limitations: [
      "Elapsed wall time включает создание semantic Document, настоящую compiled HUD-композицию, Workbench model, layout flush, scheduler и async settle с Bun.sleep(0); это не process CPU time, GPU не используется",
      "A→B→A измеряет публичный keyboard focus с layout; восстановление использует настоящий pointer input и hit testing",
      "Исходники импортированы до замера; компиляция, WebRTC, live Browser frame и backdrop GPU cost сюда не входят",
    ],
    gpuEvidence: process.env.WINDOW_INTEGRATION_GPU_EVIDENCE ?? null,
  }, null, 2))
}, 120000)
