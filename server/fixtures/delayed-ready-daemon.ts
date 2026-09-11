console.error("Storybook startup: catalog")
await Bun.sleep(21_000)
await import("../../scripts/storybook-daemon.ts")
