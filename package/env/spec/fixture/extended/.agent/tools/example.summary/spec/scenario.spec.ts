import {expect, test} from "bun:test"
import summary from "../index"
test("Описание", () => { expect(summary()).toEqual({summary: "Локальный инструмент"}) })
