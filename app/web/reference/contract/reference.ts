/** Состояние совместимости свидетельства с текущим предметом без решения о приёмке. */
export type Compatibility = "compatible" | "changed" | "unverified"

/** Приёмку задаёт предоставивший свидетельство владелец; отображение её не меняет. */
export type Acceptance = "candidate" | "accepted" | "superseded"

/**
Условия получения растрового свидетельства.

@property width - Ширина viewport при получении свидетельства в CSS px.

@property height - Высота того же viewport в CSS px.

@property devicePixelRatio - Физических пикселей на CSS px при получении свидетельства.
*/
export type Viewport = Readonly<{
  width: number
  height: number
  devicePixelRatio: number
}>

/**
Неизменный растровый ресурс свидетельства.

@property url - Корневой относительный либо HTTP(S) адрес ресурса, предоставленного приложением.

@property width - Ширина растра в физических пикселях.

@property height - Высота растра в физических пикселях.

@property sha256 - SHA-256 неизменных байтов растра в нижнем шестнадцатеричном регистре.
*/
export type Asset = Readonly<{
  url: string
  width: number
  height: number
  alt: string
  sha256: string
}>

/** Описание свидетельства; загрузка ресурса и изменение приёмки остаются у предоставившего владельца. */
export type Descriptor = Readonly<{
  id: string
  label: string
  provenance: string
  compatibility: Compatibility
  acceptance: Acceptance
  viewport: Viewport
  asset: Asset
}>
