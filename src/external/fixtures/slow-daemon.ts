import {writeFileSync} from "node:fs"

const path = Bun.env.STORYBOOK_START_LEASE_PATH
const token = Bun.env.STORYBOOK_START_LEASE_TOKEN
const marker = Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
if (path === undefined || token === undefined || marker === undefined) {
  throw new Error("slow-daemon requires startup lease and marker environment")
}
writeFileSync(marker, String(process.pid) + "\n")
const stop = (): void => {
  process.exit(0)
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
await Bun.sleep(30_000)
