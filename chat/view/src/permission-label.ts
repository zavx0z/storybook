/** Локализует известные фразы провайдера, сохраняя буквальные условия правила. */
export function permissionLabel(source: string): string {
  if (source === "Yes, proceed") return "Разрешить один раз"
  if (source === "No, and tell Codex what to do differently") return "Отклонить и дать Codex другое указание"
  const commandPrefix = "Yes, and don't ask again for commands that start with "
  if (source.startsWith(commandPrefix)) return `Разрешить и больше не спрашивать для команд с префиксом ${source.slice(commandPrefix.length)}`
  return source
}
