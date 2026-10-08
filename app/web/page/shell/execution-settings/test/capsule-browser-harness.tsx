import {useState} from "@zavx0z/immersive-component"
import {BrowserPreview} from "../src/browser-preview"
import type {createSettingsClient} from "../src/client"
import type {createBrowserPreviewSession} from "../src/browser-preview-session"

export function Harness(props: Readonly<{provider?: "capsule" | "chrome-studio", client: ReturnType<typeof createSettingsClient>, sessionFactory: typeof createBrowserPreviewSession}>) {
  const [available, setAvailable] = useState(true)
  return <section>
    <button onClick={() => setAvailable(false)}>Изменить подключение</button>
    <BrowserPreview
      provider={props.provider ?? "capsule"}
      connectionId="qwen"
      available={available}
      client={props.client}
      sessionFactory={props.sessionFactory}
    />
  </section>
}
