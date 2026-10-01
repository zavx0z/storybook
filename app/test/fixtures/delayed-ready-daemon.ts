console.error("Storybook startup: catalog")
await Bun.sleep(21_000)
await import("../../src/daemon-entry.ts")
