import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Event, InputEvent, type HTMLButtonElement, type HTMLInputElement, type HTMLSelectElement} from "@zavx0z/immersive-dom"
import ExecutionSettings from "@zavx0z/storybook-app-web-page-shell-execution-settings"

const settings = {schemaVersion: 1, revision: 0, connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}], general: {connectionId: "codex"}, types: {}}
describe.each([{name: "Настройки среды", props: {
  fetcher: mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("execution-settings-save")) {const value = JSON.parse(String(init?.body)).settings; return Response.json({...value, revision: value.revision + 1})}
    return Response.json(url.endsWith("registry-session") ? {readerToken: "fixture"}
      : url.endsWith("execution-options") ? [
        {id: "model", category: "model", name: "Модель", value: "native", options: [{value: "native", name: "Native Model"}]},
        {id: "effort", category: "thought_level", name: "Мышление", value: "high", options: [{value: "high", name: "High"}]},
      ] : settings)
  }) as unknown as typeof fetch,
}}])("$name", async ({props}) => {
  const headless = createHeadless({width: 900, height: 760})
  afterAll(() => headless.dispose())
  const element = await headless.render(<ExecutionSettings {...props} />)
  test("Закрытое окно", () => {
    expect(element.querySelector("[data-provider-settings]"), "Закрытое окно освобождает форму и каталоги").toBeNull()
  })
  test("Подключения", async () => {
    ;(element.querySelector('button[aria-label="Подключения и модели"]') as HTMLButtonElement).click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(element.textContent, "Сразу открыт выбор модели для нужной области").toContain("Репозитории")
    expect([...element.querySelectorAll("button")].some(item => item.textContent === "Сохранить"), "Без изменений кнопки сохранения нет").toBe(false)
  })
  test("Модели без ручной загрузки", async () => {
    const tab = [...element.querySelectorAll('button[role="tab"]')].find(item => item.textContent === "Модели по умолчанию") as HTMLButtonElement
    tab.click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(element.textContent, "Варианты появляются при открытии раздела, без служебной кнопки загрузки").toContain("Native Model")
    expect(element.querySelectorAll("select").length, "Внутри уровня остаются только модель и мышление").toBe(2)
    if (process.env.SETTINGS_UI_CAPTURE) await Bun.write(process.env.SETTINGS_UI_CAPTURE, await headless.screenshot(element))
  })
  test("Выбор для репозиториев и сохранение", async () => {
    ;([...element.querySelectorAll('[data-settings-level="Repo"] button')].find(item => item.textContent === "Репозитории") as HTMLButtonElement).click()
    await headless.capture(element)
    const model = element.querySelector('[data-settings-level="Repo"] select') as HTMLSelectElement
    model.value = "native"
    model.dispatchEvent(new Event("change", {bubbles: true}))
    await headless.capture(element)
    ;([...element.querySelectorAll("button")].find(item => item.textContent === "Сохранить") as HTMLButtonElement).click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(props.fetcher, "Выбранная модель сохраняется для Repo, а не меняет все сущности").toHaveBeenCalledWith("/api/browser/chat/execution-settings-save", expect.objectContaining({body: expect.stringContaining('"Repo":{"model":"native"}')}))
    expect(element.textContent, "Завершённое действие подтверждено человеку").toContain("Сохранено")
  })
  test("Компактные действия только после изменения", async () => {
    ;([...element.querySelectorAll('button[role="tab"]')].find(item => item.textContent === "Подключения") as HTMLButtonElement).click()
    await headless.capture(element)
    const input = element.querySelector('input') as HTMLInputElement
    input.value = "Рабочий Codex"
    input.dispatchEvent(new InputEvent("input", {bubbles: true}))
    await headless.capture(element)
    const save = [...element.querySelectorAll("button")].find(item => item.textContent === "Сохранить") as HTMLButtonElement
    expect(save.getBoundingClientRect().width, "Кнопка присутствует в раскладке").toBeGreaterThan(44)
    expect(save.getBoundingClientRect().width, "Основное действие имеет ширину содержимого, а не растягивается на окно").toBeLessThan(200)
    ;([...element.querySelectorAll("button")].find(item => item.textContent === "Отменить") as HTMLButtonElement).click()
    await headless.capture(element)
    expect((element.querySelector("input") as HTMLInputElement).value, "Отмена возвращает сохранённое имя без запроса к серверу").toBe("Codex")
  })
})
