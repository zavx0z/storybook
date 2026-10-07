import {expect, test} from "bun:test"
import {createStorybookScopeAddress} from "../src/implementation"

test("адрес фонового дисплея не изменяет History выбранного предмета", () => {
  const location = {href: "http://localhost/", pathname: "/"}
  const entries: string[] = []
  const write = (_data: unknown, _unused: string, value?: string | URL | null) => {
    const next = new URL(String(value), location.href)
    location.href = next.href
    location.pathname = next.pathname
    entries.push(next.pathname + next.search)
  }
  const history = {pushState: write, replaceState: write}
  const a = createStorybookScopeAddress({kind: "landing", pathname: "/a", readerToken: "a"}, location, history, () => {})
  const b = createStorybookScopeAddress({kind: "landing", pathname: "/b", readerToken: "b"}, location, history, () => {})
  a.commit("replace")
  a.history.replaceState(null, "", "/a?inspector=chat")
  a.deactivate()
  b.commit("push")
  a.history.replaceState(null, "", "/a?inspector=tree")
  expect(location.pathname).toBe("/b")
  expect(a.location.pathname).toBe("/a")
  expect(a.address).toBe("/a?inspector=tree")
  b.deactivate()
  a.commit("push")
  expect(location.href).toBe("http://localhost/a?inspector=tree")
  expect(entries).toEqual(["/a", "/a?inspector=chat", "/b", "/a?inspector=tree"])
  a.commit("push")
  expect(entries).toHaveLength(4)
})

test("popstate не переносит новый browser URL в адрес покидаемого дисплея", () => {
  const location = {href: "http://localhost/b", pathname: "/b"}
  const history = {pushState(_data: unknown, _unused: string, value?: string | URL | null) {
    const next = new URL(String(value), location.href)
    location.href = next.href
    location.pathname = next.pathname
  }, replaceState(_data: unknown, _unused: string, value?: string | URL | null) {
    this.pushState(_data, _unused, value)
  }}
  const b = createStorybookScopeAddress({kind: "landing", pathname: "/b", readerToken: "b"}, location, history, () => {})
  b.commit("replace")
  location.href = "http://localhost/a"
  location.pathname = "/a"
  b.deactivate()
  expect(b.address).toBe("/b")
  b.commit("push")
  expect(location.pathname).toBe("/b")
})
