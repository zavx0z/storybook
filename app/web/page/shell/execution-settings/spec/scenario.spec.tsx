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
    ;(element.querySelector('button[aria-label="Настройки"]') as HTMLButtonElement).click()
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
    expect(element.querySelectorAll("select").length, "Уровень показывает провайдера, модель, мышление и подтверждения").toBe(4)
    if (process.env.SETTINGS_UI_CAPTURE) await Bun.write(process.env.SETTINGS_UI_CAPTURE, await headless.screenshot(element))
  })
  test("Выбор для репозиториев и сохранение", async () => {
    ;([...element.querySelectorAll('[data-settings-level="Repo"] button')].find(item => item.textContent === "Репозитории") as HTMLButtonElement).click()
    await headless.capture(element)
    const model = element.querySelectorAll('[data-settings-level="Repo"] select')[1] as HTMLSelectElement
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
    ;([...element.querySelectorAll('button[role="tab"]')].find(item => item.textContent === "Провайдеры") as HTMLButtonElement).click()
    await headless.capture(element)
    expect(element.querySelector("input[type=text]"), "Свёрнутые подключения не показывают поля редактирования").toBeNull()
    ;([...element.querySelectorAll("button")].find(item => item.textContent === "Codex") as HTMLButtonElement).click()
    await headless.capture(element)
    expect((element.querySelector('input[type="checkbox"]') as HTMLInputElement).checked, "Подключение включается чекбоксом в заголовке").toBe(true)
    ;(element.querySelector('button[aria-label="Развернуть Codex"]') as HTMLButtonElement).click()
    await headless.capture(element)
    const input = element.querySelector('[data-provider-connection="codex"] input[type="text"]') as HTMLInputElement
    input.value = "Рабочий Codex"
    input.dispatchEvent(new InputEvent("input", {bubbles: true}))
    await headless.capture(element)
    const save = [...element.querySelectorAll("button")].find(item => item.textContent === "Сохранить") as HTMLButtonElement
    expect(save.getBoundingClientRect().width, "Кнопка присутствует в раскладке").toBeGreaterThan(44)
    expect(save.getBoundingClientRect().width, "Основное действие имеет ширину содержимого, а не растягивается на окно").toBeLessThan(200)
    ;([...element.querySelectorAll("button")].find(item => item.textContent === "Отменить") as HTMLButtonElement).click()
    await headless.capture(element)
    expect((element.querySelector('[data-provider-connection="codex"] input[type="text"]') as HTMLInputElement).value, "Отмена возвращает сохранённое имя без запроса к серверу").toBe("Codex")
  })
  test("Новое подключение Ollama", async () => {
    ;(element.querySelector('button[aria-label="Добавить Ollama"]') as HTMLButtonElement).click()
    await headless.capture(element)
    const card = element.querySelector('[data-provider-connection="ollama"]')!
    const api = card.querySelectorAll("input")[1] as HTMLInputElement
    api.value = "http://ai-srv:11434"
    api.dispatchEvent(new InputEvent("input", {bubbles: true}))
    await headless.capture(element)
    const probe = card.closest('[data-panel]')!.querySelector('button[aria-label="Проверить подключение"]') as HTMLButtonElement
    expect(probe.disabled, "Несохранённый адрес не отправляется серверу при проверке подключения").toBe(true)
    ;([...element.querySelectorAll("button")].find(item => item.textContent === "Сохранить") as HTMLButtonElement).click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(props.fetcher, "Сетевой Ollama сохраняется как самостоятельный провайдер с URL API").toHaveBeenCalledWith(
      "/api/browser/chat/execution-settings-save",
      expect.objectContaining({body: expect.stringContaining('"provider":"ollama","label":"Ollama","enabled":true,"endpoint":{"url":"http://ai-srv:11434"}')}),
    )
    expect(probe.disabled, "После сохранения сервер проверяет зарегистрированное подключение по id").toBe(false)
    probe.click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(props.fetcher, "В запросе проверки передан только сохранённый id").toHaveBeenCalledWith(
      "/api/browser/chat/execution-options", expect.objectContaining({body: '{"connectionId":"ollama"}'}),
    )
  })
  test("SSH-подключение", async () => {
    const card = element.querySelector('[data-provider-connection="ollama"]')!
    const toggle = card.querySelector('input[type="checkbox"]') as HTMLInputElement
    toggle.click()
    await headless.capture(element)
    ;([...card.querySelectorAll("button")].find(item => item.textContent === "SSH") as HTMLButtonElement).click()
    await headless.capture(element)
    const fields = card.querySelectorAll('[aria-label="SSH"] input')
    for (const [index, value] of ["ai-srv-origin", "developer", "2222"].entries()) {
      const input = fields[index] as HTMLInputElement
      input.value = value
      input.dispatchEvent(new InputEvent("input", {bubbles: true}))
      await headless.capture(element)
    }
    ;([...element.querySelectorAll("button")].find(item => item.textContent === "Сохранить") as HTMLButtonElement).click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(props.fetcher, "SSH сохраняет alias, пользователя и порт, используя существующую авторизацию хоста").toHaveBeenCalledWith(
      "/api/browser/chat/execution-settings-save", expect.objectContaining({body: expect.stringContaining('"ssh":{"host":"ai-srv-origin","user":"developer","port":2222}')}),
    )
  })

  test("Capsule с готовым профилем", async () => {
    const add = element.querySelector('button[aria-label="Добавить Capsule"]') as HTMLButtonElement
    add.click()
    await headless.capture(element)
    const card = element.querySelector('[data-provider-connection="capsule"]')!
    expect(card.querySelector("video"), "Новое несохранённое подключение не открывает видеосессию").toBeNull()
    expect(card.textContent, "Просмотр профиля находится внутри подключения Capsule").toContain("Браузер")
    const fields = card.querySelector('[aria-label="Подключение Capsule"]')!
    const address = fields.querySelectorAll("input")[0] as HTMLInputElement
    expect(address.value, "Форма предлагает адрес локального Capsule Studio").toBe("http://127.0.0.1:17777")
    const profile = fields.querySelectorAll("input")[1] as HTMLInputElement
    expect(profile.value, "Имя существующего профиля задаётся явно").toBe("")
    profile.value = "work"
    profile.dispatchEvent(new InputEvent("input", {bubbles: true}))
    await headless.capture(element)
    const service = fields.querySelector("select") as HTMLSelectElement
    expect([...service.querySelectorAll("option")].filter(option => !option.hasAttribute("disabled")).map(option => option.getAttribute("value")), "Подключение поддерживает Qwen, DeepSeek и ChatGPT").toEqual(["qwen", "deepseek", "chatgpt"])
    service.value = "chatgpt"
    service.dispatchEvent(new Event("change", {bubbles: true}))
    await headless.capture(element)
    const probe = card.closest('[data-panel]')!.querySelector('button[aria-label="Проверить подключение"]') as HTMLButtonElement
    expect(probe.disabled, "Проверка возможностей доступна после сохранения профиля и сервиса").toBe(true)
    const save = [...element.querySelectorAll("button")].find(item => item.textContent === "Сохранить") as HTMLButtonElement
    save.click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(props.fetcher, "Сохраняются адрес Studio, готовый профиль и выбранный сервис").toHaveBeenCalledWith(
      "/api/browser/chat/execution-settings-save",
      expect.objectContaining({body: expect.stringContaining('"provider":"capsule","label":"Capsule","enabled":true,"endpoint":{"url":"http://127.0.0.1:17777","profile":"work","service":"chatgpt"}')}),
    )
    expect(probe.disabled, "Сохранённое подключение готово к проверке").toBe(false)
    probe.click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(props.fetcher, "Проверка обращается к сохранённому подключению, не передавая настройки профиля из браузера").toHaveBeenCalledWith(
      "/api/browser/chat/execution-options", expect.objectContaining({body: '{"connectionId":"capsule"}'}),
    )
    expect(card.textContent, "Форма объясняет настройки пользователя без технических деталей браузера").not.toContain("CDP")
  })

  test("Capsule на другой машине", async () => {
    const card = element.querySelector('[data-provider-connection="capsule"]')!
    const toggle = card.querySelector('input[type="checkbox"]') as HTMLInputElement
    toggle.click()
    await headless.capture(element)
    ;([...card.querySelectorAll("button")].find(item => item.textContent === "SSH") as HTMLButtonElement).click()
    await headless.capture(element)
    expect(card.querySelector('[aria-label="Удалённое исполнение Capsule"]'), "SSH раскрывает параметры исполнения на другой машине").not.toBeNull()
    const fields = card.querySelectorAll('[aria-label="Удалённое исполнение Capsule"] input')
    for (const [index, value] of ["mesh-production1", "admin", "22", "/Users/admin/repozitarium/provider", "/Users/admin/.local/share/zavx0z/provider", "capsule-qwen"].entries()) {
      const input = fields[index] as HTMLInputElement
      input.value = value
      input.dispatchEvent(new InputEvent("input", {bubbles: true}))
      await headless.capture(element)
    }
    const save = [...element.querySelectorAll("button")].find(item => item.textContent === "Сохранить") as HTMLButtonElement
    save.click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(props.fetcher, "Удалённое подключение сохраняет SSH и пути исполнения").toHaveBeenCalledWith("/api/browser/chat/execution-settings-save", expect.objectContaining({
      body: expect.stringContaining('"ssh":{"providerRoot":"/Users/admin/repozitarium/provider","storageRoot":"/Users/admin/.local/share/zavx0z/provider","host":"mesh-production1","user":"admin","port":22,"dockerContext":"capsule-qwen"}'),
    }))
    expect((card.querySelector('[aria-label="Подключение Capsule"] input') as HTMLInputElement).value, "SSH сохраняет адрес Studio на машине исполнения").toBe("http://127.0.0.1:17777")
    toggle.click()
    await headless.capture(element)
    expect(card.querySelector('[aria-label="Удалённое исполнение Capsule"]'), "Отключение SSH скрывает удалённые параметры").toBeNull()
  })

  test("Chrome Studio использует существующий профиль и SSH без Docker", async () => {
    ;(element.querySelector('button[aria-label="Добавить Chrome Studio"]') as HTMLButtonElement).click()
    await headless.capture(element)
    const card = element.querySelector('[data-provider-connection="chrome-studio"]')!
    const fields = card.querySelector('[aria-label="Подключение Chrome Studio"]')!
    expect((fields.querySelector("select") as HTMLSelectElement).value, "Новый Studio provider предлагает DeepSeek").toBe("deepseek")
    const service = fields.querySelector("select") as HTMLSelectElement
    service.value = "chatgpt"
    service.dispatchEvent(new Event("change", {bubbles: true}))
    await headless.capture(element)
    const profile = fields.querySelectorAll("input")[1] as HTMLInputElement
    profile.value = "deepseek-profile"
    profile.dispatchEvent(new InputEvent("input", {bubbles: true}))
    await headless.capture(element)
    ;(fields.querySelector('input[type="checkbox"]') as HTMLInputElement).click()
    ;([...fields.querySelectorAll("button")].find(item => item.textContent === "SSH") as HTMLButtonElement).click()
    await headless.capture(element)
    const remote = card.querySelector('[aria-label="Удалённое исполнение Chrome Studio"]')!
    const inputs = remote.querySelectorAll("input")
    expect(inputs.length, "Studio не требует Docker context").toBe(5)
    for (const [index, value] of ["second-mac", "admin", "22", "/repos/provider", "/data/provider"].entries()) {
      const input = inputs[index] as HTMLInputElement
      input.value = value
      input.dispatchEvent(new InputEvent("input", {bubbles: true}))
      await headless.capture(element)
    }
    ;([...element.querySelectorAll("button")].find(item => item.textContent === "Сохранить") as HTMLButtonElement).click()
    await headless.capture(element)
    await new Promise(resolve => setTimeout(resolve, 0))
    await headless.capture(element)
    expect(props.fetcher, "Сохраняется самостоятельное подключение Chrome Studio").toHaveBeenCalledWith(
      "/api/browser/chat/execution-settings-save",
      expect.objectContaining({body: expect.stringContaining('"provider":"chrome-studio","label":"Chrome Studio","enabled":true,"endpoint":{"url":"http://127.0.0.1:17778","profile":"deepseek-profile","service":"chatgpt"}')}),
    )
    expect(card.querySelector("video"), "Studio ACP не открывает Capsule viewer").toBeNull()
  })

})
