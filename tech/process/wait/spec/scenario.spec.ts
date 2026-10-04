import {describe, expect, test} from "bun:test"
import waitForOwnedChild from "@storybook-tech-process/wait"

describe.each([
  {
    name: "Вывод завершившегося процесса",
    props: {outputLimit: 1024},
    source: "process.stdout.write('ready'); process.stderr.write('diagnostic')",
    expected: {exitCode: 0, stdout: "ready", stderr: "diagnostic"},
  },
  {
    name: "Вывод сверх ограничения",
    props: {outputLimit: 8},
    source: "process.stdout.write('x'.repeat(131072)); process.stderr.write('y'.repeat(131072))",
    expected: {exitCode: 0, stdout: "xxxxxxxx", stderr: "yyyyyyyy"},
  },
  {
    name: "Пустые потоки и ненулевой код завершения",
    props: {outputLimit: 1024},
    source: "process.exit(7)",
    expected: {exitCode: 7, stdout: "", stderr: ""},
  },
])("$name", async ({props, source, expected}) => {
  const child = Bun.spawn([process.execPath, "-e", source], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const result = await waitForOwnedChild({
    child,
    signal: new AbortController().signal,
    timeoutMs: 2000,
    label: "Пример ожидания процесса",
    outputLimit: props.outputLimit,
  })

  test("Результат завершения", () => {
    expect(result, "Ожидание возвращает код завершения и сохранённые стандартные потоки").toEqual({
      exitCode: expected.exitCode,
      stdout: expected.stdout,
      stderr: expected.stderr,
    })
  })
  test("Код завершения", async () => {
    expect(result.exitCode, "Возвращённый код подтверждён точным дочерним handle").toBe(await child.exited)
  })
  test("Объём вывода", () => {
    expect(new TextEncoder().encode(result.stdout).length, "stdout сохраняет не более заданного числа байтов").toBeLessThanOrEqual(props.outputLimit)
    expect(new TextEncoder().encode(result.stderr).length, "stderr имеет независимое ограничение сохранённых байтов").toBeLessThanOrEqual(props.outputLimit)
  })
  test("Неизменяемый результат", () => {
    expect(Object.isFrozen(result), "Завершённое ожидание публикует замороженный результат").toBeTrue()
  })
})
