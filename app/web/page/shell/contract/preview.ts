import type {Node as SemanticNode} from "@zavx0z/dom"

/**
Положение обзора в единственном пространстве страницы.

Используется правая система координат с осью Z вверх; расстояния заданы в миллиметрах.

@property position - Положение точки обзора по координатам `x`, `y`, `z`.

@property target - Точка, на которую направлен обзор, в той же системе координат.

@property [fov] - Передаваемый угол поля зрения.

@property [near] - Расстояние до ближней плоскости отсечения.

@property [far] - Расстояние до дальней плоскости отсечения.
*/
export type StorybookSpacePreviewCamera = Readonly<{
  position: Readonly<{x: number; y: number; z: number}>
  target: Readonly<{x: number; y: number; z: number}>
  fov?: number
  near?: number
  far?: number
}>

/**
Границы одного пространственного просмотра в логических координатах и буфере кадра.

@property x - Горизонтальное положение логической области.

@property y - Вертикальное положение логической области.

@property width - Логическая ширина области.

@property height - Логическая высота области.

@property backingX - Горизонтальное положение в буфере кадра, в пикселях.

@property backingY - Вертикальное положение в буфере кадра, в пикселях.

@property backingWidth - Ширина в буфере кадра, в пикселях.

@property backingHeight - Высота в буфере кадра, в пикселях.

@property pixelRatio - Отношение размера буфера кадра к логическому размеру.
*/
export type StorybookSpacePreviewViewport = Readonly<{
  x: number
  y: number
  width: number
  height: number
  backingX: number
  backingY: number
  backingWidth: number
  backingHeight: number
  pixelRatio: number
}>

/**
Согласованная регистрация семантического узла и его показа в общем пространстве.

@property node - Семантический узел пространственного содержимого.

@property camera - Исходное положение обзора {@link StorybookSpacePreviewCamera}.

@property [cameraGestures] - Управление обзором жестами при его включении.
*/
export type StorybookSpacePreviewRegistration = Readonly<{
  node: SemanticNode
  camera: StorybookSpacePreviewCamera
  cameraGestures?: boolean
  /**
  Получает новые логические границы и размеры буфера кадра при изменении области просмотра.
  */
  resize?(viewport: StorybookSpacePreviewViewport): void
  /**
  Обрабатывает двойной щелчок в пространственном просмотре, если обработчик задан.
  */
  onDoubleClick?(): void
}>

/**
Ограниченное управление обзором и кадрами без доступа к внутреннему Renderer.

@property frames - Счётчик кадров пространственного просмотра.

@property disposed - Признак завершённого жизненного цикла просмотра.
*/
export type StorybookSpacePreview = Readonly<{
  readonly frames: number
  readonly disposed: boolean
  /**
  Запрашивает следующий кадр пространственного просмотра.
  */
  requestRender(): void
  /**
  Возвращает точку обзора к исходному положению.
  */
  resetViewPoint(): void
  /**
  Освобождает регистрацию пространственного просмотра.
  */
  dispose(): void
}>


/** Геометрия общей области просмотра в логических пикселях. */
export type StorybookPreviewBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}>
