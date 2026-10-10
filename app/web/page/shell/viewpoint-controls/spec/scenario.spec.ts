import {afterAll, describe, expect, test} from "bun:test"
import {createDocument} from "@zavx0z/immersive"
import {createSpaceElementFactories} from "@zavx0z/immersive/space"
import createViewPointControls from "../index"

describe.each([
  {name: "Замороженные жесты", props: {controls: false}},
  {name: "Свободное управление", props: {controls: true}},
])("$name", ({props}) => {
  const document = createDocument({elementFactories: createSpaceElementFactories()})
  const camera = document.createElement("viewpoint")
  camera.x = 0
  camera.y = -100
  camera.z = 0
  camera.controls = props.controls
  const controls = createViewPointControls()
  controls.bind(camera, () => camera.dollyTo(100))
  afterAll(() => controls.dispose())

  test("Заморозка жестов", () => {
    expect(controls.getSnapshot(), "Состояние HUD соответствует controls существующей камеры").toEqual({ready: true, frozen: !props.controls})
    controls.toggleFrozen()
    expect(camera.controls, "Команда меняет разрешение жестов, сохраняя ViewPoint").toBe(!props.controls)
    controls.toggleFrozen()
  })

  test("Масштаб и вписывание", () => {
    controls.zoom(.5)
    expect(camera.y, "Явное приближение сохраняет направление и уменьшает расстояние до цели").toBe(-50)
    controls.fit()
    expect(camera.y, "Вписывание делегируется принимающей оболочке").toBe(-100)
    expect(camera.controls, "Явные команды не переключают режим жестов").toBe(props.controls)
  })
})


test("configured zoom делегируется viewer, а необработанный factor сохраняет legacy dollyTo", () => {
  const document = createDocument({elementFactories: createSpaceElementFactories()})
  const camera = document.createElement("viewpoint")
  camera.x = 0
  camera.y = -100
  camera.z = 0
  const controls = createViewPointControls()
  const requests: number[] = []
  let configured = true
  controls.bind(camera, () => {}, undefined, factor => {
    if (!configured) return false
    requests.push(factor)
    return true
  })
  try {
    controls.zoom(.5)
    expect(requests).toEqual([.5])
    expect(camera.y).toBe(-100)
    configured = false
    controls.zoom(.5)
    expect(camera.y).toBe(-50)
    controls.bind(camera, () => {})
    configured = true
    controls.zoom(.5)
    expect(camera.y).toBe(-25)
    expect(requests).toEqual([.5])
    expect(() => controls.zoom(0)).toThrow(RangeError)
  } finally { controls.dispose() }
})
