<template>
  <div class="drawing-canvas-container">
    <canvas
      ref="canvasRef"
      class="drawing-canvas"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseUp"
      :style="{ cursor: getCursor() }"
    ></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed, onUnmounted } from 'vue';
import { useDrawingStore } from '../stores/drawing';
import type { Point, DrawingElement } from '../types/drawing';
import { nanoid } from 'nanoid';
import getStroke from 'perfect-freehand';
import { useSelection } from '../composables/useSelection';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const ctx = ref<CanvasRenderingContext2D | null>(null);
const isDrawing = ref(false);
const startPoint = ref<Point | null>(null);
const dragOffset = ref<Point | null>(null); // 拖动时的偏移量
const selectionBox = ref<{ start: Point; end: Point } | null>(null); // 框选状态
const store = useDrawingStore();

// 集成选中与缩放
const {
  selectedIds,
  resizing,
  resizeAnchor,
  getAnchors,
  hitAnchor,
  selectElement,
  selectElementsInBox,
  resizeElement
} = useSelection(store.elements);

const selectedElements = computed(() =>
  store.elements.filter(el => selectedIds.value.includes(el.id))
);

// 鼠标悬停锚点索引
const hoverAnchor = ref<number | null>(null);

const history = ref<DrawingElement[][]>([]);
const redoStack = ref<DrawingElement[][]>([]);

const rotating = ref(false);
const rotateStartAngle = ref(0);
const rotateStartRotation = ref(0);

function pushHistory() {
  // 深拷贝当前 elements
  history.value.push(store.elements.map(el => ({ ...el, points: el.points.map(p => ({ ...p })) })));
  // 操作后清空 redoStack
  redoStack.value = [];
}

function undo() {
  if (history.value.length > 0) {
    redoStack.value.push(store.elements.map(el => ({ ...el, points: el.points.map(p => ({ ...p })) })));
    const prev = history.value.pop();
    if (prev) {
      store.elements.splice(0, store.elements.length, ...prev.map(el => ({ ...el, points: el.points.map(p => ({ ...p })) })));
    }
    redrawCanvas();
  }
}

function redo() {
  if (redoStack.value.length > 0) {
    history.value.push(store.elements.map(el => ({ ...el, points: el.points.map(p => ({ ...p })) })));
    const next = redoStack.value.pop();
    if (next) {
      store.elements.splice(0, store.elements.length, ...next.map(el => ({ ...el, points: el.points.map(p => ({ ...p })) })));
    }
    redrawCanvas();
  }
}

// 在所有会更改 elements 的操作前调用 pushHistory
function safePushHistory() {
  // 只在鼠标操作开始时 push，避免重复 push
  if (!isDrawing.value && !resizing.value && !dragOffset.value && !selectionBox.value) {
    pushHistory();
  }
}

const getCursor = () => {
  if (store.currentTool === 'select') {
    if (hoverAnchor.value !== null) return 'nwse-resize';
    if (resizing.value) return 'nwse-resize';
    return selectedIds.value.length > 0 ? 'move' : 'default';
  }
  return 'crosshair';
};

const initCanvas = () => {
  if (!canvasRef.value) return;
  const canvas = canvasRef.value;
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  ctx.value = canvas.getContext('2d');
  if (ctx.value) {
    ctx.value.lineCap = 'round';
    ctx.value.lineJoin = 'round';
  }
};

const drawElement = (element: DrawingElement, highlight = false) => {
  if (!ctx.value) return;
  ctx.value.save();
  // freehand 选中时高亮为蓝色
  if (element.type === 'freehand' && highlight) {
    ctx.value.strokeStyle = '#1976d2';
  } else {
    ctx.value.strokeStyle = element.color;
  }
  ctx.value.lineWidth = element.strokeWidth;

  // 旋转支持
  const [start, end] = element.points;
  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const rotation = element.rotation || 0;
  ctx.value.translate(centerX, centerY);
  ctx.value.rotate(rotation);
  ctx.value.translate(-centerX, -centerY);

  if (element.type === 'freehand') {
    const stroke = getStroke(element.points, {
      size: element.strokeWidth,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
    });
    if (stroke.length > 0) {
      ctx.value.beginPath();
      ctx.value.moveTo(stroke[0][0], stroke[0][1]);
      for (let i = 1; i < stroke.length; i++) {
        ctx.value.lineTo(stroke[i][0], stroke[i][1]);
      }
      ctx.value.stroke();
    }
  } else if (element.type === 'rectangle') {
    ctx.value.strokeRect(
      start.x,
      start.y,
      end.x - start.x,
      end.y - start.y
    );
  } else if (element.type === 'ellipse') {
    const radiusX = Math.abs(end.x - start.x) / 2;
    const radiusY = Math.abs(end.y - start.y) / 2;
    ctx.value.beginPath();
    ctx.value.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.value.stroke();
  } else if (element.type === 'line') {
    ctx.value.beginPath();
    ctx.value.moveTo(start.x, start.y);
    ctx.value.lineTo(end.x, end.y);
    ctx.value.stroke();
  }
  ctx.value.restore();
};

const drawAnchors = (element: DrawingElement) => {
  if (!ctx.value) return;
  if (element.type === 'freehand') return; // 铅笔选中时不绘制选择框和锚点
  const [start, end] = element.points;
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxX = Math.max(start.x, end.x);
  const maxY = Math.max(start.y, end.y);
  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const rotation = element.rotation || 0;

  // 旋转后的四角坐标
  function rotatePoint(x: number, y: number) {
    const dx = x - centerX;
    const dy = y - centerY;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
      x: centerX + dx * cos - dy * sin,
      y: centerY + dx * sin + dy * cos
    };
  }
  const corners = [
    rotatePoint(minX - 8, minY - 8), // 左上
    rotatePoint(maxX + 8, minY - 8), // 右上
    rotatePoint(maxX + 8, maxY + 8), // 右下
    rotatePoint(minX - 8, maxY + 8), // 左下
  ];

  ctx.value.save();
  // 浅蓝色细实线外框
  ctx.value.strokeStyle = '#42a5f5';
  ctx.value.lineWidth = 1.5;
  ctx.value.beginPath();
  ctx.value.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.value.lineTo(corners[i].x, corners[i].y);
  ctx.value.closePath();
  ctx.value.stroke();

  // 四角圆角锚点（与外框重叠）
  corners.forEach((pt, idx) => {
    if (!ctx.value) return;
    ctx.value.save();
    ctx.value.beginPath();
    ctx.value.lineWidth = hoverAnchor.value === idx ? 3 : 2;
    ctx.value.strokeStyle = hoverAnchor.value === idx ? '#1976d2' : '#42a5f5';
    ctx.value.fillStyle = hoverAnchor.value === idx ? '#bbdefb' : '#fff';
    if (ctx.value.roundRect) {
      ctx.value.roundRect(pt.x - 6, pt.y - 6, 12, 12, 3);
    } else {
      ctx.value.rect(pt.x - 6, pt.y - 6, 12, 12);
    }
    ctx.value.fill();
    ctx.value.stroke();
    ctx.value.restore();
  });

  // 顶部中点圆点（旋转锚点样式）
  const topCenterRaw = { x: (start.x + end.x) / 2, y: minY - 24 };
  const topCenter = rotatePoint(topCenterRaw.x, topCenterRaw.y);
  ctx.value.beginPath();
  ctx.value.arc(topCenter.x, topCenter.y, 7, 0, Math.PI * 2);
  ctx.value.fillStyle = '#fff';
  ctx.value.strokeStyle = '#42a5f5';
  ctx.value.lineWidth = 1.5;
  ctx.value.fill();
  ctx.value.stroke();

  ctx.value.restore();
};

const drawSelectionBox = () => {
  if (!ctx.value || !selectionBox.value) return;
  const { start, end } = selectionBox.value;
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxX = Math.max(start.x, end.x);
  const maxY = Math.max(start.y, end.y);
  ctx.value.save();
  ctx.value.globalAlpha = 0.12;
  ctx.value.fillStyle = '#1976d2';
  ctx.value.fillRect(minX, minY, maxX - minX, maxY - minY);
  ctx.value.globalAlpha = 1;
  ctx.value.strokeStyle = '#1976d2';
  ctx.value.lineWidth = 1.5;
  ctx.value.setLineDash([6, 4]);
  ctx.value.strokeRect(minX, minY, maxX - minX, maxY - minY);
  ctx.value.setLineDash([]);
  ctx.value.restore();
};

const redrawCanvas = () => {
  if (!ctx.value || !canvasRef.value) return;
  ctx.value.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height);
  store.elements.forEach(el => {
    drawElement(el, selectedIds.value.includes(el.id));
  });
  // 多选时为每个选中元素绘制锚点
  selectedElements.value.forEach(el => drawAnchors(el));
  // 框选时绘制选区
  if (selectionBox.value) drawSelectionBox();
};

function isOnRotateAnchor(point: Point, element: DrawingElement) {
  const [start, end] = element.points;
  const minY = Math.min(start.y, end.y);
  const centerX = (start.x + end.x) / 2;
  const topCenter = { x: centerX, y: minY - 24 };
  const dx = point.x - topCenter.x;
  const dy = point.y - topCenter.y;
  return Math.sqrt(dx * dx + dy * dy) <= 10;
}

const handleMouseDown = (e: MouseEvent) => {
  if (!canvasRef.value) return;
  safePushHistory();
  const rect = canvasRef.value.getBoundingClientRect();
  const point = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };

  if (store.currentTool === 'select') {
    // 检查是否点击了选中元素的锚点
    if (selectedIds.value.length === 1) {
      const selected = selectedElements.value[0];
      if (selected) {
        // 检查顶部旋转锚点
        if (isOnRotateAnchor(point, selected)) {
          rotating.value = true;
          const [start, end] = selected.points;
          const centerX = (start.x + end.x) / 2;
          const centerY = (start.y + end.y) / 2;
          rotateStartAngle.value = Math.atan2(point.y - centerY, point.x - centerX);
          rotateStartRotation.value = selected.rotation || 0;
          startPoint.value = point;
          return;
        }
        const anchors = getAnchors(selected);
        const anchorIndex = hitAnchor(point, anchors);
        if (anchorIndex !== null) {
          resizing.value = true;
          resizeAnchor.value = anchorIndex;
          startPoint.value = point;
          return;
        }
      }
    }
    // 优先判断是否点中任意图形
    let hitAny = false;
    for (let i = store.elements.length - 1; i >= 0; i--) {
      const el = store.elements[i];
      if (hitTestPointInElement(point, el)) {
        if (
          selectedIds.value.length > 1 && selectedIds.value.includes(el.id)
        ) {
          // 多选且点中已选图形，直接拖动多选
          dragOffset.value = {
            x: point.x - selectedElements.value[0].points[0].x,
            y: point.y - selectedElements.value[0].points[0].y
          };
          startPoint.value = point;
        } else {
          // 单选或点中未被选中的图形，切换为单选
          selectedIds.value = [el.id];
          dragOffset.value = {
            x: point.x - el.points[0].x,
            y: point.y - el.points[0].y
          };
          startPoint.value = point;
        }
        hitAny = true;
        break;
      }
    }
    if (!hitAny) {
      // 空白处，进入框选
      selectionBox.value = { start: point, end: point };
      startPoint.value = point;
      dragOffset.value = null;
      selectedIds.value = [];
    }
  } else {
    // 开始绘制新元素
    if (store.currentTool === 'freehand') {
      selectedIds.value = [];
    }
    isDrawing.value = true;
    startPoint.value = point;
    const newElement = {
      id: nanoid(),
      type: store.currentTool,
      points: [point, point],
      color: store.color,
      strokeWidth: store.strokeWidth
    };
    store.addElement(newElement);
    // 只有非 freehand 时自动选中
    if (store.currentTool !== 'freehand') {
      selectedIds.value = [newElement.id];
    }
  }
};

function hitTestPointInElement(point: Point, element: DrawingElement) {
  if (element.type === 'rectangle') {
    const [start, end] = element.points;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  } else if (element.type === 'ellipse') {
    const [start, end] = element.points;
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const rx = Math.abs(end.x - start.x) / 2;
    const ry = Math.abs(end.y - start.y) / 2;
    if (rx === 0 || ry === 0) return false;
    return (
      ((point.x - cx) ** 2) / (rx ** 2) + ((point.y - cy) ** 2) / (ry ** 2) <= 1
    );
  } else if (element.type === 'line') {
    const [start, end] = element.points;
    const dist = Math.abs(
      (end.y - start.y) * point.x - (end.x - start.x) * point.y + end.x * start.y - end.y * start.x
    ) / Math.sqrt((end.y - start.y) ** 2 + (end.x - start.x) ** 2);
    return dist < 8;
  } else if (element.type === 'freehand') {
    const pts = element.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const A = point.x - a.x;
      const B = point.y - a.y;
      const C = b.x - a.x;
      const D = b.y - a.y;
      const dot = A * C + B * D;
      const len_sq = C * C + D * D;
      let param = -1;
      if (len_sq !== 0) param = dot / len_sq;
      let xx, yy;
      if (param < 0) { xx = a.x; yy = a.y; }
      else if (param > 1) { xx = b.x; yy = b.y; }
      else { xx = a.x + param * C; yy = a.y + param * D; }
      const dx = point.x - xx;
      const dy = point.y - yy;
      if (Math.sqrt(dx * dx + dy * dy) < 8) return true;
    }
    return false;
  }
  return false;
}

const handleMouseMove = (e: MouseEvent) => {
  if (!canvasRef.value) return;
  const rect = canvasRef.value.getBoundingClientRect();
  const point = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };

  // 旋转交互
  if (rotating.value && selectedIds.value.length === 1) {
    const selected = selectedElements.value[0];
    if (selected) {
      const [start, end] = selected.points;
      const centerX = (start.x + end.x) / 2;
      const centerY = (start.y + end.y) / 2;
      const angle = Math.atan2(point.y - centerY, point.x - centerX);
      selected.rotation = rotateStartRotation.value + (angle - rotateStartAngle.value);
      redrawCanvas();
    }
    return;
  }

  // 框选时更新选区
  if (selectionBox.value && startPoint.value) {
    selectionBox.value.end = point;
    redrawCanvas();
    return;
  }

  // 悬停锚点高亮
  if (store.currentTool === 'select' && selectedIds.value.length === 1 && !resizing.value) {
    const selected = selectedElements.value[0];
    if (selected) {
      const anchors = getAnchors(selected);
      const anchorIndex = hitAnchor(point, anchors);
      hoverAnchor.value = anchorIndex;
    }
  } else {
    hoverAnchor.value = null;
  }

  if (store.currentTool === 'select') {
    if (resizing.value && selectedIds.value.length === 1 && startPoint.value) {
      const selected = selectedElements.value[0];
      if (selected && resizeAnchor.value !== null) {
        resizeElement(selected, resizeAnchor.value, point);
        selected.points = [...selected.points];
        redrawCanvas();
      }
    } else if (selectedIds.value.length > 0 && startPoint.value && dragOffset.value) {
      // 多选拖动
      const dx = point.x - startPoint.value.x;
      const dy = point.y - startPoint.value.y;
      selectedElements.value.forEach(el => {
        const newPoints = el.points.map(p => ({
          x: p.x + dx,
          y: p.y + dy
        }));
        el.points = [...newPoints];
      });
      startPoint.value = point;
      redrawCanvas();
    }
  } else if (isDrawing.value && startPoint.value) {
    const currentElement = store.elements[store.elements.length - 1];
    if (currentElement) {
      if (currentElement.type === 'freehand') {
        currentElement.points = [...currentElement.points, point];
      } else {
        currentElement.points = [startPoint.value, point];
      }
      redrawCanvas();
    }
  }
};

const handleMouseUp = () => {
  // 如果是刚画完图形，且不是 freehand，自动选中最后一个
  if (isDrawing.value && store.elements.length > 0 && store.currentTool !== 'freehand') {
    const lastId = store.elements[store.elements.length - 1].id;
    selectedIds.value = [lastId];
  }
  isDrawing.value = false;
  resizing.value = false;
  rotateStartAngle.value = 0;
  rotateStartRotation.value = 0;
  rotating.value = false;
  resizeAnchor.value = null;
  dragOffset.value = null;
  // 框选结束，批量选中
  if (selectionBox.value) {
    selectElementsInBox(selectionBox.value.start, selectionBox.value.end);
    selectionBox.value = null;
  }
  startPoint.value = null;
  // 只有非 freehand 时自动切换到选择工具
  if (store.currentTool !== 'select' && store.currentTool !== 'freehand') {
    store.setCurrentTool('select');
  }
  // 鼠标松开后如果有变更，pushHistory
  if (!selectionBox.value && (isDrawing.value || resizing.value || dragOffset.value)) {
    pushHistory();
  }
};

onMounted(() => {
  initCanvas();
  window.addEventListener('resize', initCanvas);
  // 监听键盘删除
  window.addEventListener('keydown', handleKeyDown);
});

function handleKeyDown(e: KeyboardEvent) {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.value.length > 0) {
    pushHistory();
    selectedIds.value.forEach(id => store.deleteElement(id));
    selectedIds.value = [];
    redrawCanvas();
  }
  // 撤销
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
  // 恢复
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  }
}

onUnmounted(() => {
  window.removeEventListener('resize', initCanvas);
  window.removeEventListener('keydown', handleKeyDown);
});

watch(() => store.elements, redrawCanvas, { deep: true });
watch(selectedIds, redrawCanvas);
</script>

<style scoped lang="scss">
.drawing-canvas-container {
  width: 100%;
  height: 100%;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.drawing-canvas {
  width: 100%;
  height: 100%;
}
</style> 