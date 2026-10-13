import {expect, test} from "bun:test"
import {Event, type HTMLButtonElement, type HTMLSelectElement} from "@zavx0z/immersive"
import {createHeadless} from "@zavx0z/immersive/headless"
import {Harness} from "./capsule-browser-harness"
import {createBrowserPreviewSession} from "../src/browser-preview-session"
import type {BrowserProfileCatalog, SettingsClient} from "../src/client"

function fixture() {
  const headless = createHeadless({width: 800, height: 900})
  let catalog: BrowserProfileCatalog = {profiles: [{name: "saved-profile", label: "Готовый профиль", canOpen: true, saves: [{id: "save-1", title: "Сохранение 1"}]}],
    current: {name: "working-profile", saveId: null, active: true}, capabilities: {open: true, save: true}}
  const calls: Array<{kind: string; selection?: {name: string; saveId: string | null}}> = []
  let opens = 0, closes = 0, refuseOpen = false, badOpen = false, badSave = false
  let hold: Promise<void> | undefined
  const client: SettingsClient = {
    async read() {return {schemaVersion: 1, revision: 0, connections: [], general: {}, types: {}}},
    async save(value) {return value}, async options() {return []},
    async openBrowserViewer() {opens++; return {instanceId: `instance-${opens}`, profile: catalog.current!.name, socketPath: "/viewer?ticket=owned", controlEnabled: true}},
    async browserViewerConfiguration() {return {iceServers: []}},
    async browserProfiles(_connection, signal) {signal.throwIfAborted(); calls.push({kind: "read"}); return catalog},
    async openBrowserProfile(_connection, selection, signal) {
      calls.push({kind: "open", selection})
      await hold
      signal.throwIfAborted()
      if (refuseOpen) throw new Error("Owner refused Open")
      if (!badOpen) catalog = {...catalog, current: {...selection, active: true}}
      return catalog
    },
    async saveBrowserProfile(_connection, signal) {
      signal.throwIfAborted()
      calls.push({kind: "save"})
      if (!badSave) catalog = {...catalog, current: {...catalog.current!, saveId: "saved-current", active: false},
        profiles: catalog.profiles.map(profile => profile.name === catalog.current?.name ? {...profile, saves: [...profile.saves, {id: "saved-current"}]} : profile)}
      return catalog
    },
  }
  const sessionFactory: typeof createBrowserPreviewSession = options => createBrowserPreviewSession({...options,
    viewerFactory: () => ({connect() {}, close() {closes++}, sendControl() {return true}}),
    mediaFactory: () => ({async attach() {}, clear() {}, setMuted() {}}),
  })
  return {headless, client, sessionFactory, calls, counts: () => ({opens, closes}),
    refuse(value: boolean) {refuseOpen = value}, unconfirmedOpen(value: boolean) {badOpen = value}, unconfirmedSave(value: boolean) {badSave = value}, hold(value: Promise<void>) {hold = value}}
}

test("profile read/refresh and local selection preserve the same viewer; explicit observed Open reconnects once and Save leaves it closed", async () => {
  const f = fixture()
  try {
    const element = await f.headless.render(<Harness client={f.client} sessionFactory={f.sessionFactory} />)
    const settle = async () => {await Bun.sleep(0); await f.headless.capture(element); await Bun.sleep(0); await f.headless.capture(element)}
    const button = (label: string) => [...element.querySelectorAll("button")].find(node => node.textContent === label) as HTMLButtonElement
    button("Браузер").click()
    await settle()
    const first = element.querySelector("video")!
    expect(first).not.toBeNull()
    expect(f.counts()).toEqual({opens: 1, closes: 0})
    expect(f.calls).toEqual([{kind: "read"}])
    button("Обновить").click()
    await settle()
    expect(element.querySelector("video")).toBe(first)
    const select = async (index: number, value: string) => {
      const node = element.querySelectorAll("select")[index] as HTMLSelectElement
      node.value = value
      node.dispatchEvent(new Event("change", {bubbles: true}))
      await settle()
    }
    await select(0, "saved-profile")
    await select(1, "save:save-1")
    expect(f.calls.every(row => row.kind === "read")).toBe(true)
    expect(element.querySelector("video")).toBe(first)
    const gate = Promise.withResolvers<void>()
    f.hold(gate.promise)
    button("Открыть").click()
    await settle()
    expect(element.querySelector("video")).toBe(first)
    expect(f.counts().opens).toBe(1)
    gate.resolve()
    await settle()
    const second = element.querySelector("video")!
    expect(second).not.toBe(first)
    expect(second.ownerDocument).toBe(first.ownerDocument)
    expect(f.counts()).toEqual({opens: 2, closes: 1})
    expect(f.calls.filter(row => row.kind === "open")).toEqual([{kind: "open", selection: {name: "saved-profile", saveId: "save-1"}}])
    button("Сохранить профиль").click()
    await settle()
    expect(element.querySelector("video")).toBeNull()
    expect(f.counts()).toEqual({opens: 2, closes: 2})
    expect(element.textContent).toContain("Профиль сохранён. Просмотр закрыт")
    button("Обновить").click()
    await settle()
    expect(element.querySelector("video")).toBeNull()
    expect(f.counts().opens).toBe(2)
  } finally {await f.headless.dispose()}
}, 15000)

test("refused or unconfirmed profile operations never claim success or release the working viewer", async () => {
  const f = fixture()
  try {
    const element = await f.headless.render(<Harness client={f.client} sessionFactory={f.sessionFactory} />)
    const settle = async () => {await Bun.sleep(0); await f.headless.capture(element); await Bun.sleep(0); await f.headless.capture(element)}
    const button = (label: string) => [...element.querySelectorAll("button")].find(node => node.textContent === label) as HTMLButtonElement
    button("Браузер").click()
    await settle()
    const first = element.querySelector("video")!
    expect(button("Открыть").disabled).toBe(false)
    f.refuse(true)
    button("Открыть").click()
    await settle()
    expect(f.calls.at(-1)).toEqual({kind: "open", selection: {name: "working-profile", saveId: null}})
    expect(element.textContent).toContain("Owner refused Open")
    expect(element.textContent).not.toContain("Профиль открыт")
    const profile = element.querySelectorAll("select")[0] as HTMLSelectElement
    profile.value = "saved-profile"
    profile.dispatchEvent(new Event("change", {bubbles: true}))
    await settle()
    const save = element.querySelectorAll("select")[1] as HTMLSelectElement
    save.value = "save:save-1"
    save.dispatchEvent(new Event("change", {bubbles: true}))
    await settle()
    f.refuse(false)
    f.unconfirmedOpen(true)
    button("Открыть").click()
    await settle()
    expect(element.textContent).toContain("не подтвердил открытие")
    expect(element.querySelector("video")).toBe(first)
    f.unconfirmedSave(true)
    button("Сохранить профиль").click()
    await settle()
    expect(element.textContent).toContain("не подтвердил сохранение")
    expect(element.textContent).not.toContain("Профиль сохранён")
    expect(element.querySelector("video")).toBe(first)
    expect(f.counts()).toEqual({opens: 1, closes: 0})
  } finally {await f.headless.dispose()}
}, 15000)
