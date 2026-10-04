import type {Zavx0zStorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
type StorybookSharedHost = Awaited<ReturnType<Zavx0zStorybookAppWebProtocol.Output["readSharedHost"]>>

/**
Доставляет новую оболочку также уже открытой landing прежнего выпуска.
Её parser требует entry до вызова штатного refreshSharedHost; значение выводится
из того же host. Новые страницы читают проверенный host и не используют entry.
*/
export function sharedHostEvent(host: StorybookSharedHost) {
  return Object.freeze({type: "shared.updated" as const, host, entry: host.pageEntryUrl})
}
