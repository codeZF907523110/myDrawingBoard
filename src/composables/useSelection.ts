import { ref } from "vue";
import type { DrawingElement, Point } from "../types/drawing";

export function useSelection(elements: DrawingElement[]) {
  const selectedIds = ref<string[]>([]);
  const resizing = ref(false);
  const resizeAnchor = ref<number | null>(null); // 0-3: 四个角

  // 判断点是否在元素内部（仅支持矩形、椭圆、线）
  function hitTest(point: Point, element: DrawingElement): boolean {
    if (element.type === "rectangle") {
      const [start, end] = element.points;
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);
      return (
        point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
      );
    } else if (element.type === "ellipse") {
      const [start, end] = element.points;
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      if (rx === 0 || ry === 0) return false;
      return (point.x - cx) ** 2 / rx ** 2 + (point.y - cy) ** 2 / ry ** 2 <= 1;
    } else if (element.type === "line") {
      const [start, end] = element.points;
      const dist = pointToLineDistance(point, start, end);
      return dist < 8;
    } else if (element.type === "freehand") {
      // 判断点到任意一段线段的距离
      const pts = element.points;
      for (let i = 0; i < pts.length - 1; i++) {
        if (pointToLineDistance(point, pts[i], pts[i + 1]) < 8) {
          return true;
        }
      }
      return false;
    }
    return false;
  }

  function pointToLineDistance(p: Point, a: Point, b: Point) {
    const A = p.x - a.x;
    const B = p.y - a.y;
    const C = b.x - a.x;
    const D = b.y - a.y;
    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;
    let xx, yy;
    if (param < 0) {
      xx = a.x;
      yy = a.y;
    } else if (param > 1) {
      xx = b.x;
      yy = b.y;
    } else {
      xx = a.x + param * C;
      yy = a.y + param * D;
    }
    const dx = p.x - xx;
    const dy = p.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // 获取缩放锚点（四角）
  function getAnchors(element: DrawingElement): Point[] {
    if (element.type === "rectangle" || element.type === "ellipse") {
      const [start, end] = element.points;
      return [
        { x: start.x, y: start.y },
        { x: end.x, y: start.y },
        { x: end.x, y: end.y },
        { x: start.x, y: end.y },
      ];
    } else if (element.type === "line") {
      return [element.points[0], element.points[1]];
    }
    return [];
  }

  // 判断点是否在锚点上
  function hitAnchor(point: Point, anchors: Point[]): number | null {
    for (let i = 0; i < anchors.length; i++) {
      const dx = point.x - anchors[i].x;
      const dy = point.y - anchors[i].y;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return i;
    }
    return null;
  }

  // 选中单个元素
  function selectElement(point: Point): DrawingElement | null {
    for (let i = elements.length - 1; i >= 0; i--) {
      if (hitTest(point, elements[i])) {
        selectedIds.value = [elements[i].id];
        return elements[i];
      }
    }
    selectedIds.value = [];
    return null;
  }

  // 框选多个元素
  function selectElementsInBox(boxStart: Point, boxEnd: Point) {
    const minX = Math.min(boxStart.x, boxEnd.x);
    const maxX = Math.max(boxStart.x, boxEnd.x);
    const minY = Math.min(boxStart.y, boxEnd.y);
    const maxY = Math.max(boxStart.y, boxEnd.y);
    selectedIds.value = elements
      .filter((el) => {
        // 判断元素的包围盒是否与选区相交
        const pts = el.points;
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const elMinX = Math.min(...xs);
        const elMaxX = Math.max(...xs);
        const elMinY = Math.min(...ys);
        const elMaxY = Math.max(...ys);
        return (
          elMaxX >= minX && elMinX <= maxX && elMaxY >= minY && elMinY <= maxY
        );
      })
      .map((el) => el.id);
  }

  // 拖动缩放锚点
  function resizeElement(
    element: DrawingElement,
    anchorIdx: number,
    to: Point
  ) {
    if (element.type === "rectangle" || element.type === "ellipse") {
      let [start, end] = element.points;
      // 四个角锚点，0:左上 1:右上 2:右下 3:左下
      let fixed, moving;
      switch (anchorIdx) {
        case 0:
          fixed = end;
          moving = to;
          break; // 左上，固定右下
        case 1:
          fixed = { x: start.x, y: end.y };
          moving = { x: to.x, y: to.y };
          break; // 右上，固定左下
        case 2:
          fixed = start;
          moving = to;
          break; // 右下，固定左上
        case 3:
          fixed = { x: end.x, y: start.y };
          moving = { x: to.x, y: to.y };
          break; // 左下，固定右上
        default:
          fixed = end;
          moving = to;
      }
      // 重新排序，保证 start 是左上，end 是右下
      const newStart = {
        x: Math.min(fixed.x, moving.x),
        y: Math.min(fixed.y, moving.y),
      };
      const newEnd = {
        x: Math.max(fixed.x, moving.x),
        y: Math.max(fixed.y, moving.y),
      };
      element.points = [newStart, newEnd];
    } else if (element.type === "line") {
      element.points[anchorIdx] = to;
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
    resizeElement,
  };
}
