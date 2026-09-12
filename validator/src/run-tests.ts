import {lstat, mkdtemp, readFile, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join, resolve} from "node:path"
import type {ValidationInput} from "../contract/input.ts"

/** Исходный результат Bun до преобразования; вывод сохраняется целиком. */
export interface BunTestResult {
  readonly path: string
  readonly specification: string
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly junit: string | null
  readonly error: string | null
}

/**
Запускает выбранные существующие тесты и возвращает полный результат Bun.

@param input - Источник проверок и путь, передаваемый через выбранную переменную окружения.
@returns stdout, stderr, исходный JUnit и сведения о завершении процесса.

@remarks
Адрес инспектора и канал уведомлений WebStorm не передаются дочернему Bun.
Родительское окружение сохраняется. Временный отчёт удаляется после чтения.
*/
export async function runTests(input: ValidationInput): Promise<BunTestResult> {
  const path = resolve(input.path)
  const specification = resolve(input.specification)
  let cwd = dirname(specification)
  let temporary: string | undefined
  let exitCode: number | null = null
  let signal: string | null = null
  let stdout = ""
  let stderr = ""
  let junit: string | null = null
  let error: string | null = null
  try {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(input.pathVariable)) throw new Error("Некорректное имя переменной входного пути")
    const timeout = input.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error("Таймаут должен быть положительным целым числом")
    const info = await lstat(specification)
    cwd = info.isDirectory() ? specification : dirname(specification)
    const files = info.isFile() ? [specification] : info.isDirectory()
      ? (await readdir(specification, {withFileTypes: true}))
        .filter(entry => entry.isFile() && /\.spec\.tsx?$/u.test(entry.name) && !/^scenario\.spec\.tsx?$/u.test(entry.name))
        .map(entry => join(specification, entry.name)).sort()
      : []
    if (files.length === 0) throw new Error("Не найдены файлы спецификации для запуска")
    temporary = await mkdtemp(join(tmpdir(), "storybook-validation-"))
    const reportPath = join(temporary, "report.xml")
    const env: NodeJS.ProcessEnv = {...process.env, [input.pathVariable]: path, FORCE_COLOR: "0", NO_COLOR: "1"}
    delete env.BUN_INSPECT
    delete env.BUN_INSPECT_NOTIFY
    const child = Bun.spawn({
      cmd: [process.execPath, "test", ...files, "--reporter=junit", "--reporter-outfile", reportPath,
        ...(input.testNamePattern === undefined ? [] : ["--test-name-pattern", input.testNamePattern])],
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout,
    })
    const completed = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    exitCode = completed[0]
    stdout = completed[1]
    stderr = completed[2]
    signal = child.signalCode ?? null
    junit = await readFile(reportPath, "utf8")
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (temporary !== undefined) {
      try {
        await rm(temporary, {recursive: true, force: true})
      } catch (cause) {
        error ??= cause instanceof Error ? cause.message : String(cause)
      }
    }
  }
  return {path, specification, cwd, exitCode, signal, stdout, stderr, junit, error}
}
