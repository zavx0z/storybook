#!/usr/bin/env bun
/**
Передаёт native Codex точные bootstrap overrides до запуска App Server.
Не читает и не разбирает ACP/JSON-RPC: stdin, stdout и stderr наследуются.
Процесс остаётся в detached группе владельца ACP, который подтверждает её
завершение через StorybookTechProcessWait. HOME, credentials и глобальная конфигурация
не подменяются.
*/
const command = process.env.STORYBOOK_ACP_NATIVE_COMMAND
const encoded = process.env.STORYBOOK_ACP_NATIVE_ARGUMENTS
if (!command || !encoded) throw new Error("ACP Codex launcher не получил native command и arguments")
const args: unknown = JSON.parse(encoded)
if (!Array.isArray(args) || !args.every(value => typeof value === "string")) {
  throw new TypeError("ACP Codex launcher arguments должны быть JSON-массивом строк")
}
const child = Bun.spawn([command, ...args, ...process.argv.slice(2)], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
})
const interrupt = () => child.kill("SIGINT")
const terminate = () => child.kill("SIGTERM")
process.on("SIGINT", interrupt)
process.on("SIGTERM", terminate)
try {
  process.exitCode = await child.exited
} finally {
  process.removeListener("SIGINT", interrupt)
  process.removeListener("SIGTERM", terminate)
}
