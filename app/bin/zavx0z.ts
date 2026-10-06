#!/usr/bin/env bun
import createApp from "@zavx0z/storybook-app"
import State from "@zavx0z/storybook-app-server-state"
import {homedir} from "node:os"
import {join} from "node:path"

// Первый этап запускает ровно один заранее определённый Project.
const result = await createApp().ensure({schemaVersion: 1, roots: [join(homedir(), "projects/zavx0z")]}, {
  signal: new AbortController().signal,
  onProgress: progress => { console.error(JSON.stringify(progress)) },
})
if (result.status !== "success") {
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
} else {
  const record = State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath())
  if (record === null) throw new Error("Запущенный Storybook не опубликовал адрес")
  console.log(record.origin)
}
