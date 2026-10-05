import {createHash} from "node:crypto"

/**
UUIDv5 default/legacy исполнителя выводится из устойчивого chat id. Поэтому
чтение существующей либо пустой default-беседы не требует записи ради identity.
UUID именованного нового исполнителя создаётся отдельно при явном create.
*/
export function defaultExecutorId(chatId: string): string {
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex")
  const bytes = createHash("sha1").update(namespace).update("StorybookChatSession.executor\0").update(chatId).digest().subarray(0, 16)
  bytes[6] = bytes[6]! & 0x0f | 0x50
  bytes[8] = bytes[8]! & 0x3f | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
