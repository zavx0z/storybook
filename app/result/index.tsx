import {useSyncExternalStore} from "@zavx0z/component"
import {Typography} from "@zavx0z/ui/typography"
import {CodeEditor} from "@zavx0z/ui/views/code-editor"
import type {ScenarioApp} from "../contract/output"
import {ScenarioCallResult} from "./src/call"

/**
Показывает состояние запуска и исходы вызовов. Руководство отображается как
структура файлов и примеры кода, остальные данные сохраняются в редакторе JSON.
Специальные значения сохраняют метки инспектора, ошибки не подменяются результатом.
*/
export function ScenarioResult(props: Readonly<{app: ScenarioApp}>) {
  const selected = useSyncExternalStore(props.app.subscribe, props.app.getSnapshot)
  const calls = "calls" in selected ? selected.calls : []
  const failedTests = selected.execution?.tests?.filter(test => test.status === "failed" || test.status === "error") ?? []
  const progress = selected.execution?.progress
  const stage = progress?.phase === "queued" ? "Ожидание запуска"
    : progress?.phase === "preparing" ? "Подготовка теста"
    : progress?.phase === "reporting" ? "Подготовка результата" : "Запуск теста"
  const output = progress?.output.replace(/\u001b\[[0-9;]*m/gu, "") ?? ""
  return <section
    data-scenario-result=""
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      gap: 8px;
      overflow: auto;
    `}
  >
    {selected.execution?.status === "running" ? <Typography text={stage} /> : null}
    {selected.execution?.status === "running" ? <CodeEditor
      languageId="plaintext"
      readOnly={true}
      value={output || "Ожидание вывода Bun…"}
      style={css`
        flex: 1;
        width: 100%;
        height: 100%;
        min-height: 180px;
      `}
    /> : null}
    {selected.execution?.status === "passed" ? <Typography text="Проверки пройдены" /> : null}
    {selected.execution?.status === "failed" ? <Typography text={selected.execution.message ?? "Проверки завершились с ошибками"} /> : null}
    {failedTests.map((test, index) => (
      <Typography
        key={String(index)}
        text={`${test.label}: ${test.message ?? test.status}`}
      />
    ))}
    {calls.length === 0 && selected.execution === undefined ? <Typography text="В этом варианте нет выполненных вызовов" /> : null}
    {calls.map((call, index) => <ScenarioCallResult
      key={String(index)}
      call={call}
      index={index}
      multiple={calls.length > 1}
    />)}
  </section>
}
