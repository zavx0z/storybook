import {expect, test} from "bun:test"
import {readChatSelection, selectChatSession, subscribeChatSelection} from "../src/inspector/chat-selection"

test("persisted выбор агента без беседы восстанавливается, адреса представлений делят одну identity", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const values = new Map<string, string>()
  const address = `/selection-${crypto.randomUUID()}`
  values.set(`storybook.chat.selection.v1:${address}`, JSON.stringify({executorId: "agent-only"}))
  Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {values.set(key, value)}}})
  let calls = 0
  const unsubscribe = subscribeChatSelection(`${address}?view=contract`, () => {calls++})
  try {
    expect(readChatSelection(`${address}?view=scenarios`)).toEqual({executorId: "agent-only"})
    selectChatSession(address, {executorId: "agent-only", sessionId: "session", title: "Беседа"})
    expect(calls).toBe(1)
    expect(readChatSelection(`${address}#node`)).toEqual({executorId: "agent-only", sessionId: "session", title: "Беседа"})
    expect(JSON.parse(values.get(`storybook.chat.selection.v1:${address}`)!)).toEqual({executorId: "agent-only", sessionId: "session", title: "Беседа"})
    selectChatSession(address, {executorId: "agent-only"})
    expect(JSON.parse(values.get(`storybook.chat.selection.v1:${address}`)!)).toEqual({executorId: "agent-only"})
    expect(() => selectChatSession(address, {sessionId: "orphan"})).toThrow("Некорректный выбор")
  } finally {unsubscribe(); if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage")}
})

test("повреждённая persisted selection не превращается в адрес чужой сессии", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const value = JSON.stringify({sessionId: "orphan", title: "Нет агента"})
  Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {getItem: () => value}})
  try {expect(readChatSelection(`/selection-invalid-${crypto.randomUUID()}`)).toEqual({})}
  finally {if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage")}
})
