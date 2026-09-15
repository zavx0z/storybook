import {basename, resolve} from "node:path"

/** Сохраняет действующее чтение назначения из заметки либо README владельца. */
export async function readDescription(directory: string): Promise<string> {
  const readme = Bun.file(resolve(directory, "README.md"))
  let source = await readme.exists() ? await readme.text() : ""
  const overview = source.trim().split(/\r?\n\r?\n/u)[1]?.replace(/\s+/gu, " ").trim()
  if (overview && !overview.startsWith("#") && !overview.startsWith("```") && !overview.startsWith("- ")) return overview
  const note = source.match(/^- \[[^\]]+\]\(\.\/notes\/([a-z0-9-]+\.md)\)$/m)
  if (note?.[1]) source = await Bun.file(resolve(directory, "notes", note[1])).text()
  const paragraph = source.trim().split(/\r?\n\r?\n/u)[1]?.replace(/\s+/gu, " ").trim()
  return paragraph && !paragraph.startsWith("#") && !paragraph.startsWith("```") ? paragraph : ""
}

/** Читает заголовок документа у его владельца; имя директории сохраняется при отсутствии заголовка. */
export async function readTitle(directory: string): Promise<string> {
  const file = Bun.file(resolve(directory, "README.md"))
  return await file.exists() ? (await file.text()).match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? basename(directory) : basename(directory)
}
