import {describe, expect, test} from "bun:test"
import {attachPickedDirectory, pickStorybookDirectory} from "./directory-picker.ts"

describe("native project directory selection", () => {
  test("calls the browser picker immediately with the required directory permission", async () => {
    const calls: unknown[] = []
    const directory = {} as FileSystemDirectoryHandle
    const pending = pickStorybookDirectory({showDirectoryPicker(options) {
      calls.push(options)
      return Promise.resolve(directory)
    }})
    expect(calls).toEqual([{id: "storybook-project", mode: "readwrite"}])
    expect(await pending).toBe(directory)
    await expect(pickStorybookDirectory({})).rejects.toThrow("выбор папки")
  })

  test("removes the selected directory proof even when attachment fails", async () => {
    const steps: string[] = []
    const directory = {
      async getFileHandle() {
        return {async createWritable() { return {
          async write() { steps.push("write") },
          async close() { steps.push("close") },
          async abort() {},
        } }}
      },
      async removeEntry() { steps.push("remove") },
    } as unknown as FileSystemDirectoryHandle
    const token = "11111111-1111-4111-8111-111111111111"
    await expect(attachPickedDirectory(directory, async action => {
      steps.push(action)
      if (action === "attach") throw new Error("Invalid declaration")
      return {token, filename: `.storybook-selection-${token}`, content: "proof"}
    })).rejects.toThrow("Invalid declaration")
    expect(steps).toEqual(["directory", "write", "close", "attach", "remove"])
  })
})
