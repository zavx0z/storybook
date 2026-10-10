import {expect, test} from "bun:test"
import {createDocument} from "@zavx0z/immersive"
import {ViewPoint} from "@zavx0z/immersive/engine"
import type {SpatialTreeSnapshot} from "@zavx0z/immersive/nodes/spatial/tree"
import {bindStorybookDisplayGlass} from "../src/display-glass"

type Selection = Pick<SpatialTreeSnapshot, "selectedId" | "nodes">
const viewport = {width: 1000, height: 600}
const nodes: SpatialTreeSnapshot["nodes"] = [
  {id: "/", label: "Project", depth: 0, color: "#fff", viewport, rect: {x: -125, y: -75, z: 0, width: 250, height: 150}},
  {id: "/repo", label: "Repo", depth: 1, color: "#fff", viewport, rect: {x: 250, y: -75, z: -500, width: 250, height: 150}},
]

function fixture() {
  const document = createDocument()
  const space = document.createElement("space")
  const viewPoint = document.createElement("viewpoint")
  const baseDisplay = document.createElement("display")
  document.append(space)
  space.append(viewPoint, baseDisplay)
  const displays = new Map(nodes.map(node => {
    const display = document.createElement("display")
    display.id = node.id
    space.append(display)
    return [node.id, display] as const
  }))
  let snapshot: Selection | null = null
  const listeners = new Set<() => void>()
  const policy = bindStorybookDisplayGlass({document, viewPoint, baseDisplay,
    displayFor: id => displays.get(id) ?? null,
    source: {getSnapshot: () => snapshot, subscribe(listener) {listeners.add(listener)
      return () => {listeners.delete(listener)}}},
  })
  policy.updateViewport(viewport)
  const pose = (value: Readonly<{position: Readonly<{x: number; y: number; z: number}>; target: Readonly<{x: number; y: number; z: number}>}>) => document.transaction(() => {
    viewPoint.x = value.position.x
    viewPoint.y = value.position.y
    viewPoint.z = value.position.z
    viewPoint.targetX = value.target.x
    viewPoint.targetY = value.target.y
    viewPoint.targetZ = value.target.z
  })
  const focus = (id: string) => {
    const rect = nodes.find(node => node.id === id)!.rect
    pose(ViewPoint.fitPoseForBounds({min: {x: rect.x, y: rect.y, z: rect.z - .001},
      max: {x: rect.x + rect.width, y: rect.y + rect.height, z: rect.z}},
    {x: 0, y: 0, z: 1}, {fov: viewPoint.fov, aspect: viewport.width / viewport.height}))
  }
  const select = (id: string) => {
    baseDisplay.hidden = true
    snapshot = {selectedId: id, nodes}
    for (const listener of listeners) listener()
  }
  const active = () => [...document.querySelectorAll('[data-storybook-display-fitted="true"]')]
  return {document, viewPoint, baseDisplay, displays, policy, pose, focus, select, active, listeners}
}

const settle = async () => {await Promise.resolve()
  await Promise.resolve()}

test("основной Display URL / использует существующий base fit и отключает blur после zoom/FOV/resize", async () => {
  const f = fixture()
  try {
    const fitted = {position: {x: 0, y: -1000, z: 0}, target: {x: 0, y: 0, z: 0}, fov: f.viewPoint.fov}
    f.policy.setBaseFit(fitted)
    f.pose(fitted)
    await settle()
    expect(f.active()).toEqual([f.baseDisplay])
    f.viewPoint.y = -1200
    await settle()
    expect(f.active()).toEqual([])
    f.pose(fitted)
    await settle()
    expect(f.active()).toEqual([f.baseDisplay])
    f.viewPoint.fov *= 1.1
    await settle()
    expect(f.active()).toEqual([])
    f.viewPoint.fov = fitted.fov
    await settle()
    expect(f.active()).toEqual([f.baseDisplay])
    f.policy.updateViewport({width: 1200, height: 700})
    expect(f.active()).toEqual([])
  } finally {f.policy.dispose()}
})

test("только выбранный адрес получает blur в точной fit pose; zoom и другой адрес снимают маркер", async () => {
  const f = fixture()
  try {
    f.select("/")
    f.focus("/")
    await settle()
    expect(f.active()).toEqual([f.displays.get("/")!])
    const selectedPosition = {x: f.viewPoint.x, y: f.viewPoint.y, z: f.viewPoint.z}
    f.viewPoint.z += 10
    await settle()
    expect(f.active()).toEqual([])
    expect(selectedPosition.z).toBeLessThan(f.viewPoint.z)
    f.focus("/")
    await settle()
    expect(f.active()).toEqual([f.displays.get("/")!])
    f.select("/repo")
    expect(f.active()).toEqual([])
    f.focus("/repo")
    await settle()
    expect(f.active()).toEqual([f.displays.get("/repo")!])
    f.select("/")
    expect(f.active()).toEqual([])
    expect(f.document.querySelectorAll("display")).toHaveLength(3)
  } finally {f.policy.dispose()}
})

test("dispose удаляет маркер и освобождает событийные подписки без изменения выбора и камеры", async () => {
  const f = fixture()
  f.select("/")
  f.focus("/")
  await settle()
  const before = [f.viewPoint.x, f.viewPoint.y, f.viewPoint.z]
  expect(f.active()).toHaveLength(1)
  f.policy.dispose()
  expect(f.active()).toEqual([])
  expect(f.listeners.size).toBe(0)
  f.viewPoint.z += 10
  await settle()
  expect(f.active()).toEqual([])
  expect(before.slice(0, 2)).toEqual([f.viewPoint.x, f.viewPoint.y])
})

const performanceOutput = process.env.DISPLAY_GLASS_PERF_OUTPUT
if (performanceOutput) test("измерение событийной политики selected Display без кадрового цикла", async () => {
  const f = fixture()
  const rawMs: number[] = []
  try {
    for (let index = -4; index < 20; index++) {
      const start = performance.now()
      f.select("/")
      f.focus("/")
      await settle()
      f.viewPoint.z += 10
      await settle()
      f.select("/repo")
      f.focus("/repo")
      await settle()
      f.select("/")
      f.focus("/")
      await settle()
      const elapsed = performance.now() - start
      expect(f.active()).toEqual([f.displays.get("/")!])
      if (index >= 0) rawMs.push(elapsed)
    }
    const sorted = [...rawMs].sort((left, right) => left - right)
    await Bun.write(performanceOutput, JSON.stringify({
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      samples: 20,
      warmup: 4,
      viewport,
      metrics: {selectedDisplayPolicyElapsed: {rawMs, medianMs: (sorted[9]! + sorted[10]!) / 2, p95Ms: sorted[18]!}},
      limitations: [
        "Elapsed wall time публичных ViewPoint mutations, Document subscribers и microtask settle; это не process CPU time",
        "Один цикл: выбор и fit URL /, zoom away, выбор и fit /repo, возвращение и fit /",
        "Три semantic Display одного Document; fixture передаёт только selectedId/nodes через существующий subscribe contract",
        "GPU, layout, SpatialTree animation и полный Workbench не измеряются; blur shader cost проверяется отдельно у Renderer",
      ],
    }, null, 2))
  } finally {f.policy.dispose()}
})
