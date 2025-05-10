import { ref } from 'vue'
import type { DrawingElement, Point } from '../types/drawing'

export function useSelection(elements: DrawingElement[]) {
  const selectedIds = ref<string[]>([])
  const resizing = ref(false)
  const resizeAnchor = ref<number | null>(null) // 0-7: 八个锚点（四角+四边中点）

  // 判断点是否在元素内部（仅支持矩形、椭圆、线）
  function hitTest(point: Point, element: DrawingElement): boolean {
    if (element.type === 'rectangle') {
      const [start, end] = element.points
      const minX = Math.min(start.x, end.x)
      const maxX = Math.max(start.x, end.x)
      const minY = Math.min(start.y, end.y)
      const maxY = Math.max(start.y, end.y)
      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
    } else if (element.type === 'ellipse') {
      const [start, end] = element.points
      const cx = (start.x + end.x) / 2
      const cy = (start.y + end.y) / 2
      const rx = Math.abs(end.x - start.x) / 2
      const ry = Math.abs(end.y - start.y) / 2
      if (rx === 0 || ry === 0) return false
      return (point.x - cx) ** 2 / rx ** 2 + (point.y - cy) ** 2 / ry ** 2 <= 1
    } else if (element.type === 'line') {
      const [start, end] = element.points
      const dist = pointToLineDistance(point, start, end)
      return dist < 8
    } else if (element.type === 'freehand') {
      // 判断点到任意一段线段的距离
      const pts = element.points
      for (let i = 0; i < pts.length - 1; i++) {
        if (pointToLineDistance(point, pts[i], pts[i + 1]) < 8) {
          return true
        }
      }
      return false
    }
    return false
  }

  function pointToLineDistance(p: Point, a: Point, b: Point) {
    const A = p.x - a.x
    const B = p.y - a.y
    const C = b.x - a.x
    const D = b.y - a.y
    const dot = A * C + B * D
    const len_sq = C * C + D * D
    let param = -1
    if (len_sq !== 0) param = dot / len_sq
    let xx, yy
    if (param < 0) {
      xx = a.x
      yy = a.y
    } else if (param > 1) {
      xx = b.x
      yy = b.y
    } else {
      xx = a.x + param * C
      yy = a.y + param * D
    }
    const dx = p.x - xx
    const dy = p.y - yy
    return Math.sqrt(dx * dx + dy * dy)
  }

  // 获取缩放锚点（四角+四边中点）
  function getAnchors(element: DrawingElement): Point[] {
    if (element.type === 'rectangle' || element.type === 'ellipse' || element.type === 'text') {
      const [start, end] = element.points
      const minX = Math.min(start.x, end.x)
      const maxX = Math.max(start.x, end.x)
      const minY = Math.min(start.y, end.y)
      const maxY = Math.max(start.y, end.y)
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2

      return [
        { x: minX, y: minY }, // 0: 左上
        { x: centerX, y: minY }, // 1: 上中
        { x: maxX, y: minY }, // 2: 右上
        { x: maxX, y: centerY }, // 3: 右中
        { x: maxX, y: maxY }, // 4: 右下
        { x: centerX, y: maxY }, // 5: 下中
        { x: minX, y: maxY }, // 6: 左下
        { x: minX, y: centerY } // 7: 左中
      ]
    } else if (element.type === 'line') {
      return [element.points[0], element.points[1]]
    }
    return []
  }

  // 判断点是否在锚点上
  function hitAnchor(point: Point, anchors: Point[]): number | null {
    for (let i = 0; i < anchors.length; i++) {
      const dx = point.x - anchors[i].x
      const dy = point.y - anchors[i].y
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return i
    }
    return null
  }

  // 选中单个元素
  function selectElement(point: Point): DrawingElement | null {
    for (let i = elements.length - 1; i >= 0; i--) {
      if (hitTest(point, elements[i])) {
        selectedIds.value = [elements[i].id]
        return elements[i]
      }
    }
    selectedIds.value = []
    return null
  }

  // 框选多个元素
  function selectElementsInBox(boxStart: Point, boxEnd: Point) {
    const minX = Math.min(boxStart.x, boxEnd.x)
    const maxX = Math.max(boxStart.x, boxEnd.x)
    const minY = Math.min(boxStart.y, boxEnd.y)
    const maxY = Math.max(boxStart.y, boxEnd.y)
    selectedIds.value = elements
      .filter(el => {
        // 判断元素的包围盒是否与选区相交
        const pts = el.points
        const xs = pts.map(p => p.x)
        const ys = pts.map(p => p.y)
        const elMinX = Math.min(...xs)
        const elMaxX = Math.max(...xs)
        const elMinY = Math.min(...ys)
        const elMaxY = Math.max(...ys)
        return elMaxX >= minX && elMinX <= maxX && elMaxY >= minY && elMinY <= maxY
      })
      .map(el => el.id)
  }

  // 拖动缩放锚点
  function resizeElement(element: DrawingElement, anchorIdx: number, to: Point) {
    if (['rectangle', 'ellipse', 'diamond', 'text'].includes(element.type)) {
      let [start, end] = element.points
      const minX = Math.min(start.x, end.x)
      const maxX = Math.max(start.x, end.x)
      const minY = Math.min(start.y, end.y)
      const maxY = Math.max(start.y, end.y)
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2

      let newStart = { ...start }
      let newEnd = { ...end }

      switch (anchorIdx) {
        case 0: // 左上
          newStart = to
          break
        case 1: // 上中
          newStart.y = to.y
          break
        case 2: // 右上
          newStart.y = to.y
          newEnd.x = to.x
          break
        case 3: // 右中
          newEnd.x = to.x
          break
        case 4: // 右下
          newEnd = to
          break
        case 5: // 下中
          newEnd.y = to.y
          break
        case 6: // 左下
          newStart.x = to.x
          newEnd.y = to.y
          break
        case 7: // 左中
          newStart.x = to.x
          break
      }

      // 确保 start 是左上角，end 是右下角
      element.points = [
        {
          x: Math.min(newStart.x, newEnd.x),
          y: Math.min(newStart.y, newEnd.y)
        },
        {
          x: Math.max(newStart.x, newEnd.x),
          y: Math.max(newStart.y, newEnd.y)
        }
      ]
    } else if (element.type === 'line') {
      element.points[anchorIdx] = to
    }
  }

  return {
    selectedIds,
    resizing,
    resizeAnchor,
    getAnchors,
    hitAnchor,
    selectElement,
    selectElementsInBox,
    resizeElement
  }
}
