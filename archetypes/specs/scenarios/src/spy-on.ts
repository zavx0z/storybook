import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"

/**
Запускает указанный файл настоящим Bun Test и возвращает историю созданных в нём spyOn.
Preload снимает историю внутри процесса после тестов; функция читает её после выхода Bun.

@param path - Путь к исполняемому файлу тестов.
@returns Код завершения, вывод процесса и сериализованные истории наблюдателей.
@throws Ошибка запуска или отсутствие отчёта preload.
*/
export async function readSpy({path}: {path: string}) {
  const temporary = await mkdtemp(join(tmpdir(), "storybook-spy-"))
  const report = join(temporary, "history.json")
  const env: NodeJS.ProcessEnv = {...process.env, STORYBOOK_SPY_REPORT: report}
  delete env.BUN_INSPECT
  delete env.BUN_INSPECT_NOTIFY
  try {
    const child = Bun.spawn([
      process.execPath, "test", "--preload", resolve(import.meta.dir, "spy-on-preload.ts"), resolve(path),
    ], {env, stdout: "pipe", stderr: "pipe", timeout: 30_000})
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    if (!await Bun.file(report).exists()) throw new Error(`Не получена история spyOn: ${stderr}`)
    const spies = await Bun.file(report).json() as Array<{name: string, history: unknown}>
    return {exitCode, spies, stdout, stderr}
  } finally {
    await rm(temporary, {recursive: true, force: true})
  }
}
