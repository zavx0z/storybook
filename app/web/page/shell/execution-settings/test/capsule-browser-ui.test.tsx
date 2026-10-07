import {expect, test} from "bun:test"
import {bindDocumentFullscreenHost, InputEvent, type HTMLInputElement, type HTMLButtonElement} from "@zavx0z/immersive-dom"
import {createHeadless} from "@zavx0z/immersive-headless"
import {SettingsContent} from "../src/content"
import {Harness} from "./capsule-browser-harness"
import {createSettingsClient} from "../src/client"
import {createCapsuleBrowserSession} from "../src/capsule-browser-session"

test("панель lazy; retry заменяет video в том же Document; dirty/collapse освобождают media без имитации видео", async () => {
  const headless = createHeadless({width: 700, height: 700})
  let opens = 0
  const mediaByVideo = new Map<object, number>()
  const mediaCleared: object[] = []
  let releaseFullscreen = () => {}
  const client = createSettingsClient(Object.assign(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("registry-session")) return Response.json({readerToken: "fixture"})
    opens++
    return Response.json({error: "Тестовый профиль остановлен"}, {status: 400})
  }, {preconnect() {}}), new AbortController().signal)
  const sessionFactory: typeof createCapsuleBrowserSession = options => createCapsuleBrowserSession({...options,
    mediaFactory: video => {
      mediaByVideo.set(video, (mediaByVideo.get(video) ?? 0) + 1)
      return {async attach() {throw new Error("Headless не подменяет remote video")}, setMuted() {}, clear() {mediaCleared.push(video)}}
    },
  })
  try {
    const element = await headless.render(<Harness client={client} sessionFactory={sessionFactory} />)
    releaseFullscreen = bindDocumentFullscreenHost(element.ownerDocument!, {enabled: () => true, async request() {}, async exit() {}})
    const button = (label: string) => [...element.querySelectorAll("button")].find(value => value.textContent === label) as HTMLButtonElement
    expect(element.querySelector("video")).toBeNull()
    expect(opens).toBe(0)
    button("Браузер").click()
    await headless.capture(element)
    await Bun.sleep(0)
    await headless.capture(element)
    const first = element.querySelector("video")!
    expect(first).not.toBeNull()
    expect(opens).toBe(1)
    expect(element.textContent).toContain("Тестовый профиль остановлен")
    const surface = element.querySelector('[data-capsule-video-surface]')!
    const notification = surface.querySelector('aside[role="alert"]')!
    expect(notification.textContent).toContain("Тестовый профиль остановлен")
    const videoBounds = first.getBoundingClientRect()
    const noticeBounds = notification.getBoundingClientRect()
    expect(noticeBounds.left).toBeCloseTo(videoBounds.left + 8, 1)
    expect(noticeBounds.bottom).toBeCloseTo(videoBounds.bottom - 8, 1)
    if (process.env.STORYBOOK_CAPSULE_NOTIFICATION_CAPTURE) {
      await Bun.write(process.env.STORYBOOK_CAPSULE_NOTIFICATION_CAPTURE, await headless.screenshot(element))
    }
    ;(notification.querySelector('button[aria-label="Закрыть уведомление"]') as HTMLButtonElement).click()
    await headless.capture(element)
    expect(surface.querySelector('aside[role="alert"]')).toBeNull()
    const clearedBeforeFullscreen = mediaCleared.length
    button("На весь экран").click()
    await Bun.sleep(0)
    const fullscreenSurface = element.querySelector('[data-capsule-browser]')!
    await headless.capture(fullscreenSurface)
    if (process.env.STORYBOOK_CAPSULE_FULLSCREEN_CAPTURE) {
      await Bun.write(process.env.STORYBOOK_CAPSULE_FULLSCREEN_CAPTURE, await headless.screenshot(fullscreenSurface))
    }
    expect(element.ownerDocument!.fullscreenElement).toBe(element.querySelector('[data-capsule-browser]'))
    expect(element.querySelector("video")).toBe(first)
    expect(opens).toBe(1)
    expect(mediaCleared).toHaveLength(clearedBeforeFullscreen)
    button("Вернуть").click()
    await Bun.sleep(0)
    await headless.capture(element)
    expect(element.ownerDocument!.fullscreenElement).toBeNull()
    expect(element.querySelector("video")).toBe(first)
    expect(mediaCleared).toHaveLength(clearedBeforeFullscreen)
    button("Переподключить").click()
    await headless.capture(element)
    await Bun.sleep(0)
    await headless.capture(element)
    const second = element.querySelector("video")!
    expect(second).not.toBe(first)
    expect(second.ownerDocument).toBe(first.ownerDocument)
    expect(mediaByVideo.size).toBe(2)
    expect([...mediaByVideo.values()]).toEqual([1, 1])
    expect(mediaCleared).toContain(first)
    expect(element.querySelector('[data-capsule-video-surface] aside[role="alert"]')).not.toBeNull()
    button("Изменить подключение").click()
    await headless.capture(element)
    expect(element.querySelector("video")).toBeNull()
    expect(mediaCleared).toContain(second)
    expect(element.textContent).toContain("Сохраните и включите подключение")
    button("Браузер").click()
    await headless.capture(element)
    expect(opens).toBe(2)
  } finally {releaseFullscreen(); await headless.dispose()}
}, 15000)

test("браузер расположен в saved Capsule ConnectionFields перед полями; редактирование разрывает preview", async () => {
  const headless = createHeadless({width: 700, height: 700})
  let opens = 0
  const settings = {schemaVersion: 1, revision: 0, connections: [{id: "capsule", label: "Сохранённый Qwen", provider: "capsule", enabled: true,
    endpoint: {url: "http://127.0.0.1:17777", profile: "work", service: "qwen"}}], general: {connectionId: "capsule"}, types: {}}
  const fetcher = Object.assign(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("registry-session")) return Response.json({readerToken: "fixture"})
    if (url.endsWith("execution-options")) return Response.json([])
    if (url.endsWith("capsule-viewer-open")) {opens++; return Response.json({error: "Тестовый профиль остановлен"}, {status: 400})}
    return Response.json(settings)
  }, {preconnect() {}})
  try {
    const element = await headless.render(<SettingsContent open={true} fetcher={fetcher} />)
    await Bun.sleep(0)
    await headless.capture(element)
    const button = (label: string) => [...element.querySelectorAll("button")].find(value => value.textContent === label) as HTMLButtonElement
    button("Провайдеры").click()
    await headless.capture(element)
    button("Capsule").click()
    await headless.capture(element)
    button("Сохранённый Qwen").click()
    await headless.capture(element)
    const card = element.querySelector('[data-provider-connection="capsule"]')!
    expect(card.children[0]!.textContent).toContain("Браузер")
    expect(opens).toBe(0)
    button("Браузер").click()
    await headless.capture(element)
    await Bun.sleep(0)
    await headless.capture(element)
    expect(card.querySelector("video")).not.toBeNull()
    expect(opens).toBe(1)
    const name = card.querySelector("input") as HTMLInputElement
    name.value = "Изменённый Qwen"
    name.dispatchEvent(new InputEvent("input", {bubbles: true}))
    await headless.capture(element)
    expect(card.querySelector("video")).toBeNull()
    expect(card.textContent).toContain("Сохраните и включите подключение")
    expect(opens).toBe(1)
  } finally {await headless.dispose()}
}, 15000)
