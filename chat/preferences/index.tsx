/**
Показывает выбор исполнителя и происхождение параметров работы.
Одна форма используется для общих значений, назначения агента и беседы.
Решение о наследовании, проверке возможностей и сохранении принимает владелец
настроек; представление передаёт только явный выбор пользователя.

@packageDocumentation
*/
import SelectField from "@zavx0z/immersive-ui-component-field-select"
import {PreferenceField} from "./src/field"
import type {StorybookChatPreferences} from "./contract"
export type {StorybookChatPreferences} from "./contract"

/** Управляемая форма не создаёт соединение и не удерживает историю чата. */
export default function ChatPreferences(props: StorybookChatPreferences.Input) {
  const change = (key: keyof typeof props.selection, value: string) => {
    const next = {...props.selection}
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
    {props.connections.length > 1 ? <SelectField
      label="Подключение"
      value={props.selection.connectionId ?? ""}
      options={[
        {key: "inherit", value: "", label: props.inheritLabel ?? "Наследовать"},
        ...props.connections.map(item => ({key: item.id, value: item.id, label: `${item.label}${item.enabled ? "" : " · отключено"}`})),
      ]}
      disabled={props.busy}
      onChange={value => change("connectionId", value)}
    /> : null}
    {props.connections.length > 1 ? <PreferenceField field="connectionId" selection={props.selection} effective={props.effective} sources={props.sources} connections={props.connections} settings={props.settings} busy={props.busy} onChange={props.onChange} /> : null}
    {(["model", "thoughtLevel"] as const).map(field => <PreferenceField
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
    />)}
  </section>
}
