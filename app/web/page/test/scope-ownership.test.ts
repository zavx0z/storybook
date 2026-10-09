import {expect, test} from "bun:test"
import {createScopeOwnership} from "../src/scope-ownership"
type Owned = {controller: {shell: object}; token: string; revision: string}

function fixture() {
  const signal = new AbortController()
  const shell = {}
  let generation = 1
  let owner: Owned | null = null
  let selected: Owned | null = null
  let live = true
  const guard = createScopeOwnership<Owned>({shell, signal: signal.signal, generation,
    readGeneration: () => generation, readOwner: () => owner, selected: () => selected, live: () => live})
  return {signal, shell, guard,
    setGeneration: (value: number) => {generation = value},
    setOwner: (value: Owned | null) => {owner = value},
    select: (value: Owned | null) => {selected = value},
    stop: () => {live = false},
  }
}

test("late unbound init не становится выбранным по одному same-id после нового foreground", () => {
  const f = fixture()
  expect(f.guard.owns()).toBe(true)
  const replacement = {controller: {shell: {}}, token: "new-token", revision: "new"}
  f.setOwner(replacement)
  f.select(replacement)
  f.setGeneration(2)
  expect(f.guard.selected()).toBe(false)
  expect(f.guard.owns()).toBe(false)
  expect(f.guard.scope()).toBeNull()
  expect(replacement).toEqual({controller: {shell: {}}, token: "new-token", revision: "new"})
})

test("Reader/revision callbacks old bound scope не получают новый same-id owner, даже при reused shell", () => {
  const f = fixture()
  const old = {controller: {shell: f.shell}, token: "old-token", revision: "old"}
  f.guard.bind(old)
  f.setOwner(old)
  f.select(old)
  expect(f.guard.selected()).toBe(true)
  const replacement = {controller: {shell: f.shell}, token: "new-token", revision: "new"}
  f.setOwner(replacement)
  f.select(replacement)
  expect(f.guard.scope()).toBeNull()
  expect(f.guard.owns()).toBe(false)
  expect(f.guard.selected()).toBe(false)
  expect(replacement.token).toBe("new-token")
  expect(replacement.revision).toBe("new")
})

test("живой зарегистрированный посещённый scope сохраняет callbacks после выбора соседнего предмета", () => {
  const f = fixture()
  const warm = {controller: {shell: f.shell}, token: "warm", revision: "a"}
  f.guard.bind(warm)
  f.setOwner(warm)
  f.setGeneration(20)
  f.select({controller: {shell: {}}, token: "selected", revision: "b"})
  expect(f.guard.owns()).toBe(true)
  expect(f.guard.scope()).toBe(warm)
  expect(f.guard.selected()).toBe(false)
  f.select(warm)
  expect(f.guard.selected()).toBe(true)
})

test("abort/dispose запрещает и selected markers, и global catalog callbacks до/после bind", () => {
  for (const bound of [false, true]) for (const reason of ["abort", "dispose"]) {
    const f = fixture()
    const scope = {controller: {shell: f.shell}, token: "token", revision: "a"}
    f.setOwner(scope)
    f.select(scope)
    if (bound) f.guard.bind(scope)
    if (reason === "abort") f.signal.abort()
    else f.stop()
    expect(f.guard.owns()).toBe(false)
    expect(f.guard.selected()).toBe(false)
    expect(f.guard.scope()).toBeNull()
  }
})
