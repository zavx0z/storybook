import {afterEach, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import createApp from "@zavx0z/storybook-app-web-page-package-scenario-model"
import Result from "@zavx0z/storybook-app-web-page-package-scenario-result"

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

test("выбранное содержимое expect занимает просмотр вместо общего результата", async () => {
  const app = createApp({kind: "function", variants: [{id: "a", title: "Вариант", source: "read()", points: [
    {title: "Документ", assertions: [{id: "doc", label: "Прочитанный документ", value: "Текст документа"}]},
  ], calls: [{id: 0, source: "read()", outcome: {type: "return", value: {path: "declaration-only"}}}]}]})
  app.selectAssertion("doc")
  const headless = createHeadless({width: 640, height: 480})
  cleanups.push(() => {app.dispose(); headless.dispose()})
  const element = await headless.render(<Result app={app} />)
  expect(element.querySelector('[data-scenario-assertion="doc"]')).not.toBeNull()
  expect(element.querySelector('[data-scenario-call]')).toBeNull()
  expect(element.textContent).toContain("Прочитанный документ")
})
