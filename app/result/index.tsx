import {useSyncExternalStore} from "@zavx0z/component"
import {Typography} from "@zavx0z/ui/typography"
import type {ScenarioApp} from "../contract/output"
import {ScenarioCallResult} from "./src/call"

/**
Показывает полные снимки исходов в редакторе JSON без вызова серверной функции.
Специальные значения сохраняют метки инспектора, ошибки не подменяются результатом.
*/
export function ScenarioResult(props: Readonly<{app: ScenarioApp}>) {
  const selected = useSyncExternalStore(props.app.subscribe, props.app.getSnapshot)
  if (!("calls" in selected)) throw new TypeError("Нет снимков вызовов функции")
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
    {selected.calls.length === 0 ? <Typography text="В этом варианте нет выполненных вызовов" /> : null}
    {selected.calls.map((call, index) => <ScenarioCallResult
      key={String(index)}
      call={call}
      index={index}
      multiple={selected.calls.length > 1}
    />)}
  </section>
}
