/**
Приватная конфигурация участника, назначенная оператором машины.

@property id - Identity локального участника, совпадающая с его admission в signaling.

@property signalingUrl - WS(S) адрес bootstrap без credentials, query и fragment.
После открытия RTC отказ bootstrap не закрывает установленные связи.

@property tokenFile - Абсолютный путь к обычному файлу текущего пользователя
без прав группы и остальных. Token читается только при первом peer запросе,
передаётся signaling отдельно от URL и не входит в public snapshots.

@property [iceServers] - Явно выбранные STUN/TURN servers и необязательные
credentials. Автоматический внешний STUN не назначается.

@property [relay] - Явное разрешение application relay через тот же signaling
server при недоступном прямом RTC. По умолчанию используется только RTC.
*/
export type PeerConfiguration = Readonly<{
  id: string
  signalingUrl: string
  tokenFile: string
  relay?: boolean
  iceServers?: readonly Readonly<{urls: string | readonly string[], username?: string, credential?: string}>[]
}>
