/**
Показывает выбор исполнителя и происхождение параметров работы.
Одна компактная форма со стандартными полями используется для общих значений,
назначения агента и беседы.
Решение о наследовании, проверке возможностей и сохранении принимает владелец
настроек; представление передаёт только явный выбор пользователя.

@packageDocumentation
*/
import Typography from "@zavx0z/immersive-ui-component-typography"
import SelectField from "@zavx0z/immersive-ui-component-field-select"
import {PreferenceField} from "./src/field"
import type {StorybookChatPreferences} from "./contract"
export type {StorybookChatPreferences} from "./contract"

/** Управляемая форма не создаёт соединение и не удерживает историю чата. */
export default function ChatPreferences(props: StorybookChatPreferences.Input) {
  const change = (key: "connectionId" | "model" | "thoughtLevel", value: string) => {
    const next = {...props.selection}
    if (key === "connectionId") {
      delete next.model
      delete next.thoughtLevel
    } else if (key === "model") delete next.thoughtLevel
    if (value) next[key] = value
    else delete next[key]
    props.onChange(next)
  }
  return <section data-execution-preferences="" style={css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  `}>
    <SelectField
      label="Провайдер"
      value={props.selection.connectionId ?? ""}
      options={[
        {key: "inherit", value: "", label: `${props.inheritLabel ?? "Наследовать"}${props.effective?.connectionId ? ` · ${props.connections.find(item => item.id === props.effective?.connectionId)?.label ?? props.effective.connectionId}` : ""}`},
        ...props.connections.map(item => ({key: item.id, value: item.id, label: `${item.label}${item.enabled ? "" : " · отключено"}`})),
      ]}
      disabled={props.busy}
      onChange={value => change("connectionId", value)}
    />
    <PreferenceField
      field="connectionId"
      selection={props.selection}
      effective={props.effective}
      sources={props.sources}
      connections={props.connections}
      settings={props.settings}
      busy={props.busy}
      onChange={props.onChange}
    />
    {(["model", "thoughtLevel"] as const).map(field => (
      <PreferenceField
        key={field}
        field={field}
        selection={props.selection}
        effective={props.effective}
        sources={props.sources}
        connections={props.connections}
        settings={props.settings}
        busy={props.busy}
        inheritLabel={props.inheritLabel}
        onChange={props.onChange}
        onValue={value => change(field, value)}
      />
    ))}
    <SelectField
      label="Подтверждения"
      value={props.selection.approvalMode ?? ""}
      options={[
        {key: "inherit", value: "", label: `Наследовать · ${props.effective?.approvalMode === "scoped-autonomous" ? "в пределах назначения" : "с подтверждениями"}`},
        {key: "ask", value: "ask", label: "С подтверждениями"},
        {key: "scoped-autonomous", value: "scoped-autonomous", label: "В пределах назначения без запросов"},
      ]}
      disabled={props.busy}
      onChange={value => {
        const next = {...props.selection}
        if (value === "ask" || value === "scoped-autonomous") next.approvalMode = value
        else delete next.approvalMode
        props.onChange(next)
      }}
    />
    <Typography
      text="Область назначения сохраняется. Отдельные запросы исполнителя за её пределами подтверждаются вручную. Автоматическая проверка действий среды пока недоступна."
    />
  </section>
}
