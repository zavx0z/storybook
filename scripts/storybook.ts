#!/usr/bin/env bun

import {fileURLToPath} from "node:url"
import {runExternalStorybookCli} from "../src/external/cli.ts"

try {
  Bun.env.STORYBOOK_INVOCATION_CWD = process.cwd()
  process.chdir(fileURLToPath(new URL("../", import.meta.url)))
  process.exitCode = await runExternalStorybookCli(Bun.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
