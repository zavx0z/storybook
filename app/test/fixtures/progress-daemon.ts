/** Стадии разделены разрешением теста; запускается только минимальный isolated daemon. */
import {existsSync, readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"

const stateRoot = Bun.env.STORYBOOK_STATE_ROOT!
await Bun.stderr.write("unrelated diagnostic\nStorybook start")
await Bun.sleep(10)
await Bun.stderr.write("up: catalog\n")
while (!existsSync(join(stateRoot, "continue-startup"))) await Bun.sleep(10)
const earlyReady = readFileSync(join(stateRoot, "continue-startup"), "utf8") === "early"
if (earlyReady) await Bun.stderr.write("Storybook startup: ready\n")
await import("./lazy-startup/daemon.ts")
if (!earlyReady) {
  // Parent публикует candidate и отвечает прежде, чем daemon пишет ready.
  while (!existsSync(join(stateRoot, "emit-ready"))) await Bun.sleep(10)
  await Bun.stderr.write("Storybook startup: ready\n")
  writeFileSync(join(stateRoot, "ready-emitted"), "ready")
}
