import {writeFileSync, writeSync} from "node:fs"

const marker = Bun.env.STORYBOOK_STDERR_FLOOD_DAEMON_MARKER
if (marker === undefined) throw new Error("stderr-flood-daemon requires a marker environment")

writeFileSync(marker, String(process.pid) + "\n")
writeSync(2, "x".repeat(128 * 1024))
writeSync(2, "\nStorybook startup: catalog\n")
process.exit(1)
