import {afterAll, describe, expect, mock as record, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import type {HTMLButtonElement} from "@zavx0z/immersive-dom"
import {Command} from "@fixture/scenario-component"

describe.each([{name: "Callback в JSX", props: {label: "Продолжить", disabled: false}}])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const labels: string[] = []
  const element = await headless.render(
    <Command
      label={props.label}
      disabled={props.disabled}
      onActivate={record((label: string) => { labels.push(label) })}
    />,
  )
  test("Вызов", () => {
    const button = element as HTMLButtonElement
    button.click()
    expect(labels, "Callback сохраняет переданную подпись").toEqual([props.label])
  })
})
