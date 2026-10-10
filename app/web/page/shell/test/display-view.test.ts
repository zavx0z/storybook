import {expect, test} from "bun:test"
import {createDocument} from "@zavx0z/immersive"
import {createRoot} from "@zavx0z/immersive/XReact"
import {DisplayElement} from "@zavx0z/immersive"
import {readDisplayStyle} from "@zavx0z/immersive/renderer/html"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import {StorybookDisplay} from "../src/display-view"

test("прежний Display поддерживает размеры окна и миниатюры без замены содержимого", () => {
  const document = createDocument()
  const space = document.createElement("space")
  document.append(space)
  const root = createRoot(space)
  type Props = Parameters<typeof StorybookDisplay>[0]
  const render = (props: Props) => root.render(StorybookDisplay as unknown as CompiledTemplate<Props>, props)
  try {
    render({id: "display"})
    const display = document.getElementById("display") as DisplayElement
    expect(readDisplayStyle(document, display).viewport).toEqual({width: 960, height: 540})
    display.setAttribute("style", "--workbench-resolution-width: 1280px; --workbench-resolution-height: 720px;")
    expect(readDisplayStyle(document, display).viewport).toEqual({width: 1280, height: 720})
  } finally { root.unmount() }

  const spatial = createRoot(space)
  const update = (width: number, height: number) => spatial.render(StorybookDisplay as unknown as CompiledTemplate<Props>, {
    id: "subject", viewport: {width, height}, surface: {x: 10, y: -.2, z: -12, width: 20, height: 20 * height / width},
  })
  try {
    update(1280, 720)
    const display = document.getElementById("subject") as DisplayElement
    const input = document.createElement("input")
    input.value = "Сохранённое содержимое"
    display.append(input)
    const before = readDisplayStyle(document, display)
    expect(before.viewport).toEqual({width: 1280, height: 720})
    expect(before.transform.position.x).toBeCloseTo(10, 10)
    expect(before.transform.position.y).toBeCloseTo(-.2, 10)
    expect(before.transform.position.z).toBeCloseTo(-12, 10)
    update(1600, 900)
    expect(document.getElementById("subject")).toBe(display)
    expect(input.parentElement).toBe(display)
    expect(input.value).toBe("Сохранённое содержимое")
    expect(readDisplayStyle(document, display).viewport).toEqual({width: 1600, height: 900})
    expect(display.width / display.height).toBeCloseTo(1600 / 900)
  } finally { spatial.unmount() }
})
