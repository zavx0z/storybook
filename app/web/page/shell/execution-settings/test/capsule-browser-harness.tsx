import {useState} from "@zavx0z/immersive-component"
import {CapsuleBrowser} from "../src/capsule-browser"
import type {createSettingsClient} from "../src/client"
import type {createCapsuleBrowserSession} from "../src/capsule-browser-session"

export function Harness(props: Readonly<{client: ReturnType<typeof createSettingsClient>, sessionFactory: typeof createCapsuleBrowserSession}>) {
  const [available, setAvailable] = useState(true)
  return <section>
    <button onClick={() => setAvailable(false)}>Изменить подключение</button>
    <CapsuleBrowser
      connectionId="qwen"
      available={available}
      client={props.client}
      sessionFactory={props.sessionFactory}
    />
  </section>
}
