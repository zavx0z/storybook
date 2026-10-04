/** Неизменное свидетельство и его сравнение сохраняют исходный масштаб изображения. */
import {describe, expect, test} from "bun:test"
import Reference from "@storybook-specs/reference"

describe.each([
  {name: "Широкое свидетельство", props: {width: 420, height: 80}, orientation: "vertical"},
  {name: "Высокое свидетельство", props: {width: 180, height: 480}, orientation: "horizontal"},
])("$name", ({props, orientation}) => {
  const input = {
    id: "component-reference", label: "Внешний вид компонента", provenance: "Контрольный снимок",
    compatibility: "unverified" as const, acceptance: "candidate" as const,
    viewport: {width: 1280, height: 720, devicePixelRatio: 2},
    asset: {url: "/reference.png", ...props, alt: "Компонент", sha256: "0123456789abcdef".repeat(4)},
  }
  const reference = Reference.define(input)
  const plan = Reference.plan({width: 1200, height: 600, subject: props, reference: props, gap: 12})
  test("Происхождение и приёмка", () => {
    expect(reference, "Чтение сохраняет факты и не меняет состояние приёмки").toEqual(input)
    expect([reference, reference.asset, reference.viewport].every(Object.isFrozen),
      "Metadata защищены от последующего изменения вызывающей стороной").toBeTrue()
  })
  test("Общий масштаб", () => {
    expect(plan.orientation, "Сравнение использует ориентацию с максимальным общим масштабом").toBe(orientation)
    expect(plan.subject.w / props.width, "Обе области используют один масштаб исходного изображения")
      .toBeCloseTo(plan.reference.w / props.width)
  })
})
