import {expect, test} from "bun:test"
import {createViewPointPersistence} from "../src/persistence"

test("положение и заморозка восстанавливаются новым экземпляром", () => {
  let saved: string | null = null
  const storage = () => ({getItem: () => saved, setItem: (_key: string, value: string) => { saved = value }})
  const first = createViewPointPersistence(storage)
  first.savePosition({edge: "right", offset: .23})
  first.saveFrozen(true)
  expect(createViewPointPersistence(storage).state).toEqual({position: {edge: "right", offset: .23}, frozen: true})
})

test("некорректные поля и недоступное хранилище не блокируют HUD", () => {
  const saved = {position: {edge: "left", offset: 2}, frozen: "false", camera: {near: -1}}
  const persistence = createViewPointPersistence(() => ({getItem: () => JSON.stringify(saved), setItem() {}}))
  expect(persistence.state).toEqual({position: {edge: "left", offset: 1}})
  const unavailable = createViewPointPersistence(() => { throw new Error("storage unavailable") })
  expect(unavailable.state.position).toEqual({edge: "top", offset: .5})
  expect(() => unavailable.saveFrozen(false)).not.toThrow()
  const malformed = createViewPointPersistence(() => ({getItem: () => "{", setItem() {}}))
  expect(malformed.state.position).toEqual({edge: "top", offset: .5})
})
