<template>
  <div class="drawing-canvas-container">
    <canvas
      ref="canvasRef"
      class="drawing-canvas"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseUp"
      @dblclick="handleDoubleClick"
      :style="{ cursor: getCursor() }"
    ></canvas>
    <!-- 添加文本输入框 -->
    <div
      v-if="textInput.visible"
      class="text-input-container"
      :style="{
        left: textInput.x + 'px',
        top: textInput.y + 'px',
        width: textInput.width + 'px',
        height: textInput.height + 'px',
        transform: `rotate(${textInput.rotation || 0}rad)`
      }"
    >
      <textarea
        ref="textareaRef"
        v-model="textInput.content"
        @blur="completeTextInput"
        @keydown.enter.prevent="completeTextInput"
        :style="{
          color: store.color,
          fontSize: store.strokeWidth * 8 + 'px'
        }"
        placeholder="输入文本"
      ></textarea>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted, watch, computed, onUnmounted, nextTick } from 'vue'
  import { useDrawingStore } from '../stores/drawing'
  import type { Point, DrawingElement } from '../types/drawing'
  import { nanoid } from 'nanoid'
  import { useSelection } from '../composables/useSelection'

  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const ctx = ref<CanvasRenderingContext2D | null>(null)
  const isDrawing = ref(false)
  const startPoint = ref<Point | null>(null)
  const dragOffset = ref<Point | null>(null) // 拖动时的偏移量
  const selectionBox = ref<{ start: Point; end: Point } | null>(null) // 框选状态
  const store = useDrawingStore()

  // 集成选中与缩放
  const { selectedIds, resizing, resizeAnchor, getAnchors, hitAnchor, selectElementsInBox, resizeElement } =
    useSelection(store.elements)

  const selectedElements = computed(() => store.elements.filter(el => selectedIds.value.includes(el.id)))

  // 鼠标悬停锚点索引
  const hoverAnchor = ref<number | null>(null)

  const history = ref<DrawingElement[][]>([])
  const redoStack = ref<DrawingElement[][]>([])

  const rotating = ref(false)
  const rotateStartAngle = ref(0)
  const rotateStartRotation = ref(0)

  // 文本输入状态
  const textInput = ref({
    visible: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    content: '',
    rotation: 0
  })

  const textareaRef = ref<HTMLTextAreaElement | null>(null)

  function pushHistory() {
    // 深拷贝当前 elements
    history.value.push(
      store.elements.map(el => ({
        ...el,
        points: el.points.map(p => ({ ...p }))
      }))
    )
    // 操作后清空 redoStack
    redoStack.value = []
  }

  function undo() {
    if (history.value.length > 0) {
      redoStack.value.push(
        store.elements.map(el => ({
          ...el,
          points: el.points.map(p => ({ ...p }))
        }))
      )
      const prev = history.value.pop()
      if (prev) {
        store.elements.splice(
          0,
          store.elements.length,
          ...prev.map(el => ({
            ...el,
            points: el.points.map(p => ({ ...p }))
          }))
        )
      }
      redrawCanvas()
    }
  }

  /**
   * 重做操作
   * 1. 将当前状态保存到历史记录
   * 2. 从重做栈中取出最近一次操作
   * 3. 用重做栈中的状态替换当前状态
   * 4. 重绘画布
   */
  function redo() {
    if (redoStack.value.length > 0) {
      // 保存当前状态到历史记录
      history.value.push(
        store.elements.map(el => ({
          ...el,
          points: el.points.map(p => ({ ...p }))
        }))
      )
      // 从重做栈中取出最近一次操作
      const next = redoStack.value.pop()
      if (next) {
        // 用重做栈中的状态替换当前状态
        store.elements.splice(
          0,
          store.elements.length,
          ...next.map(el => ({
            ...el,
            points: el.points.map(p => ({ ...p }))
          }))
        )
      }
      // 重绘画布
      redrawCanvas()
    }
  }

  // 在所有会更改 elements 的操作前调用 pushHistory
  function safePushHistory() {
    // 只在鼠标操作开始时 push，避免重复 push
    if (!isDrawing.value && !resizing.value && !dragOffset.value && !selectionBox.value) {
      pushHistory()
    }
  }

  /**
   * 获取鼠标样式
   */
  const getCursor = () => {
    if (store.currentTool === 'select') {
      if (hoverAnchor.value !== null) {
        // 根据锚点位置返回对应的鼠标样式
        switch (hoverAnchor.value) {
          case 0:
            return 'nw-resize' // 左上
          case 1:
            return 'n-resize' // 上中
          case 2:
            return 'ne-resize' // 右上
          case 3:
            return 'e-resize' // 右中
          case 4:
            return 'se-resize' // 右下
          case 5:
            return 's-resize' // 下中
          case 6:
            return 'sw-resize' // 左下
          case 7:
            return 'w-resize' // 左中
        }
      }
      if (resizing.value) {
        // 调整大小时也需要根据锚点位置设置鼠标样式
        switch (resizeAnchor.value) {
          case 0:
            return 'nw-resize' // 左上
          case 1:
            return 'n-resize' // 上中
          case 2:
            return 'ne-resize' // 右上
          case 3:
            return 'e-resize' // 右中
          case 4:
            return 'se-resize' // 右下
          case 5:
            return 's-resize' // 下中
          case 6:
            return 'sw-resize' // 左下
          case 7:
            return 'w-resize' // 左中
          default:
            return 'default'
        }
      }
      return selectedIds.value.length > 0 ? 'move' : 'default'
    }
    return 'crosshair'
  }

  /**
   * 初始化画布
   * 1. 获取画布元素
   * 2. 设置画布大小
   * 3. 获取画布上下文
   * 4. 设置画笔样式
   */
  const initCanvas = () => {
    if (!canvasRef.value) return
    const canvas = canvasRef.value
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    ctx.value = canvas.getContext('2d')
    if (ctx.value) {
      ctx.value.lineCap = 'round'
      ctx.value.lineJoin = 'round'
    }
  }

  /**
   * 绘制元素
   * 1. 保存上下文
   * 2. 设置画笔样式
   * 3. 旋转支持
   * 4. 绘制元素
   */
  const drawElement = (element: DrawingElement, highlight = false) => {
    if (!ctx.value) return

    // 如果是正在编辑的文本，则不绘制
    if (element.type === 'text' && textInput.value.visible && selectedIds.value.includes(element.id)) {
      return
    }

    ctx.value.save()
    if (element.type === 'text' && highlight) {
      ctx.value.strokeStyle = '#1976d2'
    } else {
      ctx.value.strokeStyle = element.color
    }
    ctx.value.lineWidth = element.strokeWidth

    const [start, end] = element.points
    const centerX = (start.x + end.x) / 2
    const centerY = (start.y + end.y) / 2
    const rotation = element.rotation || 0
    ctx.value.translate(centerX, centerY)
    ctx.value.rotate(rotation)
    ctx.value.translate(-centerX, -centerY)

    if (element.type === 'text') {
      // 设置文本内边距
      const padding = 8
      // 绘制文本
      const fontSize = element.strokeWidth * 8
      ctx.value.font = `${fontSize}px Arial`
      ctx.value.fillStyle = element.color
      ctx.value.textBaseline = 'top'
      // 添加文本渲染优化设置
      ctx.value.textRendering = 'geometricPrecision'
      ctx.value.imageSmoothingEnabled = false
      // 使用 strokeText 配合 fillText 让文字更清晰
      ctx.value.lineWidth = 0.5
      ctx.value.strokeStyle = element.color

      // 处理多行文本
      const text = element.text || ''
      const lineHeight = fontSize * 1.2 // 设置行高为字体大小的1.2倍

      // 计算每行的最大宽度
      const maxWidth = end.x - start.x - padding * 2

      // 手动处理文本换行
      const words = text.split('')
      let lines: string[] = []
      let currentLine = ''

      // 先按照原有的换行符分行
      const textLines = text.split('\n')
      textLines.forEach(textLine => {
        // 对每一行进行自动换行处理
        const chars = textLine.split('')
        currentLine = ''
        chars.forEach(char => {
          const testLine = currentLine + char
          const metrics = ctx.value?.measureText(testLine)
          if (metrics && metrics.width > maxWidth) {
            lines.push(currentLine)
            currentLine = char
          } else {
            currentLine += char
          }
        })
        if (currentLine) {
          lines.push(currentLine)
        }
      })

      // 绘制每一行
      lines.forEach((line, index) => {
        const y = start.y + padding + lineHeight * index
        if (ctx.value) {
          ctx.value.strokeText(line, start.x + padding, y)
          ctx.value.fillText(line, start.x + padding, y)
        }
      })

      // 绘制文本框
      if (highlight) {
        const width = end.x - start.x
        const height = end.y - start.y
        ctx.value.strokeRect(start.x, start.y, width, height)
      }
    } else if (element.type === 'rectangle') {
      ctx.value.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y)
    } else if (element.type === 'ellipse') {
      const radiusX = Math.abs(end.x - start.x) / 2
      const radiusY = Math.abs(end.y - start.y) / 2
      ctx.value.beginPath()
      ctx.value.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2)
      ctx.value.stroke()
    } else if (element.type === 'diamond') {
      // 绘制棱形
      const width = end.x - start.x
      const height = end.y - start.y
      ctx.value.beginPath()
      ctx.value.moveTo(start.x + width / 2, start.y) // 上点
      ctx.value.lineTo(end.x, start.y + height / 2) // 右点
      ctx.value.lineTo(start.x + width / 2, end.y) // 下点
      ctx.value.lineTo(start.x, start.y + height / 2) // 左点
      ctx.value.closePath()
      ctx.value.stroke()
    } else if (element.type === 'line') {
      ctx.value.beginPath()
      ctx.value.moveTo(start.x, start.y)
      ctx.value.lineTo(end.x, end.y)
      ctx.value.stroke()
    } else if (element.type === 'freehand') {
      // 绘制铅笔线条
      const points = element.points
      if (points.length < 2) return

      ctx.value.beginPath()
      ctx.value.moveTo(points[0].x, points[0].y)

      // 使用二次贝塞尔曲线使线条更平滑
      for (let i = 1; i < points.length - 2; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2
        const yc = (points[i].y + points[i + 1].y) / 2
        ctx.value.quadraticCurveTo(points[i].x, points[i].y, xc, yc)
      }

      // 处理最后两个点
      if (points.length > 2) {
        const lastPoint = points[points.length - 1]
        const secondLastPoint = points[points.length - 2]
        ctx.value.quadraticCurveTo(secondLastPoint.x, secondLastPoint.y, lastPoint.x, lastPoint.y)
      } else {
        // 如果只有两个点，直接画直线
        const lastPoint = points[points.length - 1]
        ctx.value.lineTo(lastPoint.x, lastPoint.y)
      }

      ctx.value.stroke()
    }
    ctx.value.restore()
  }

  /**
   * 计算点在旋转后的位置
   * @param x 原始x坐标
   * @param y 原始y坐标
   * @param centerX 旋转中心x坐标
   * @param centerY 旋转中心y坐标
   * @param rotation 旋转角度
   * @returns 旋转后的坐标
   */
  function rotatePoint(x: number, y: number, centerX: number, centerY: number, rotation: number) {
    const dx = x - centerX
    const dy = y - centerY
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    return {
      x: centerX + dx * cos - dy * sin,
      y: centerY + dx * sin + dy * cos
    }
  }

  /**
   * 计算点在逆旋转后的位置（用于hit test）
   * @param x 当前x坐标
   * @param y 当前y坐标
   * @param centerX 旋转中心x坐标
   * @param centerY 旋转中心y坐标
   * @param rotation 旋转角度
   * @returns 逆旋转后的坐标
   */
  function unrotatePoint(x: number, y: number, centerX: number, centerY: number, rotation: number) {
    const dx = x - centerX
    const dy = y - centerY
    const cos = Math.cos(-rotation)
    const sin = Math.sin(-rotation)
    return {
      x: centerX + dx * cos - dy * sin,
      y: centerY + dx * sin + dy * cos
    }
  }

  /**
   * 绘制元素的锚点和外选择框
   */
  const drawAnchors = (element: DrawingElement) => {
    if (!ctx.value) return
    if (element.type === 'freehand') return // 铅笔选中时不绘制选择框和锚点

    const [start, end] = element.points
    const rotation = element.rotation || 0

    if (element.type === 'line') {
      // 直线只需要两个端点的锚点
      const points = [start, end]

      ctx.value.save()
      // 绘制浅蓝色细实线外框
      ctx.value.strokeStyle = '#42a5f5'
      ctx.value.lineWidth = 1.5
      ctx.value.beginPath()
      ctx.value.moveTo(start.x, start.y)
      ctx.value.lineTo(end.x, end.y)
      ctx.value.stroke()

      // 绘制端点锚点
      points.forEach((pt, idx) => {
        if (!ctx.value) return
        ctx.value.save()
        ctx.value.beginPath()
        // 悬停时加粗并改变颜色
        ctx.value.lineWidth = hoverAnchor.value === idx ? 3 : 2
        ctx.value.strokeStyle = hoverAnchor.value === idx ? '#1976d2' : '#42a5f5'
        ctx.value.fillStyle = hoverAnchor.value === idx ? '#bbdefb' : '#fff'

        // 绘制方形锚点
        if (ctx.value.roundRect) {
          ctx.value.roundRect(pt.x - 4, pt.y - 4, 8, 8, 2)
        } else {
          ctx.value.rect(pt.x - 4, pt.y - 4, 8, 8)
        }

        ctx.value.fill()
        ctx.value.stroke()
        ctx.value.restore()
      })

      ctx.value.restore()
      return
    }

    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    // 计算所有锚点的位置（考虑8px的padding）
    const anchors = [
      rotatePoint(minX, minY, centerX, centerY, rotation), // 左上
      rotatePoint(centerX, minY, centerX, centerY, rotation), // 上中
      rotatePoint(maxX, minY, centerX, centerY, rotation), // 右上
      rotatePoint(maxX, centerY, centerX, centerY, rotation), // 右中
      rotatePoint(maxX, maxY, centerX, centerY, rotation), // 右下
      rotatePoint(centerX, maxY, centerX, centerY, rotation), // 下中
      rotatePoint(minX, maxY, centerX, centerY, rotation), // 左下
      rotatePoint(minX, centerY, centerX, centerY, rotation) // 左中
    ]

    ctx.value.save()
    // 绘制浅蓝色细实线外框
    ctx.value.strokeStyle = '#42a5f5'
    ctx.value.lineWidth = 1.5
    ctx.value.beginPath()
    ctx.value.moveTo(anchors[0].x, anchors[0].y)
    for (let i = 2; i <= 6; i += 2) {
      ctx.value.lineTo(anchors[i].x, anchors[i].y)
    }
    ctx.value.closePath()
    ctx.value.stroke()

    // 绘制锚点
    anchors.forEach((pt, idx) => {
      if (!ctx.value) return
      ctx.value.save()
      ctx.value.beginPath()
      // 悬停时加粗并改变颜色
      ctx.value.lineWidth = hoverAnchor.value === idx ? 3 : 2
      ctx.value.strokeStyle = hoverAnchor.value === idx ? '#1976d2' : '#42a5f5'
      ctx.value.fillStyle = hoverAnchor.value === idx ? '#bbdefb' : '#fff'

      // 角点使用方形，边缘点使用圆形
      if (idx % 2 === 0) {
        // 绘制方形锚点
        if (ctx.value.roundRect) {
          ctx.value.roundRect(pt.x - 4, pt.y - 4, 8, 8, 2)
        } else {
          ctx.value.rect(pt.x - 4, pt.y - 4, 8, 8)
        }
      } else {
        // 绘制圆形锚点
        ctx.value.arc(pt.x, pt.y, 4, 0, Math.PI * 2)
      }

      ctx.value.fill()
      ctx.value.stroke()
      ctx.value.restore()
    })

    // 绘制顶部中点的旋转锚点
    const topCenter = rotatePoint(centerX, minY - 24, centerX, centerY, rotation)
    ctx.value.beginPath()
    ctx.value.arc(topCenter.x, topCenter.y, 7, 0, Math.PI * 2)
    ctx.value.fillStyle = '#fff'
    ctx.value.strokeStyle = '#42a5f5'
    ctx.value.lineWidth = 1.5
    ctx.value.fill()
    ctx.value.stroke()

    ctx.value.restore()
  }

  /**
   * 判断鼠标点击位置是否在旋转锚点上
   * @param point 鼠标点击位置坐标
   * @param element 要检测的图形元素
   * @returns 是否命中旋转锚点
   */
  function isOnRotateAnchor(point: Point, element: DrawingElement) {
    const [start, end] = element.points
    const minY = Math.min(start.y, end.y)
    const centerX = (start.x + end.x) / 2
    const centerY = (start.y + end.y) / 2
    const rotation = element.rotation || 0

    // 计算旋转锚点的位置(在图形上方24px处)
    const topCenter = rotatePoint(centerX, minY - 24, centerX, centerY, rotation)

    // 计算鼠标点击位置到旋转锚点的距离
    const dx = point.x - topCenter.x
    const dy = point.y - topCenter.y
    return Math.sqrt(dx * dx + dy * dy) <= 10
  }

  /**
   * 检测鼠标是否在锚点上
   * @param point 鼠标位置
   * @param element 要检测的元素
   * @returns 命中的锚点索引，未命中返回null
   */
  function hitAnchorPoint(point: Point, element: DrawingElement) {
    const [start, end] = element.points
    const rotation = element.rotation || 0

    if (element.type === 'line') {
      // 直线只检测两个端点
      const points = [start, end]
      for (let i = 0; i < points.length; i++) {
        const pt = points[i]
        const dx = point.x - pt.x
        const dy = point.y - pt.y
        if (Math.abs(dx) <= 6 && Math.abs(dy) <= 6) {
          return i
        }
      }
      return null
    }

    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    // 计算所有锚点的位置
    const anchors = [
      rotatePoint(minX, minY, centerX, centerY, rotation), // 左上
      rotatePoint(centerX, minY, centerX, centerY, rotation), // 上中
      rotatePoint(maxX, minY, centerX, centerY, rotation), // 右上
      rotatePoint(maxX, centerY, centerX, centerY, rotation), // 右中
      rotatePoint(maxX, maxY, centerX, centerY, rotation), // 右下
      rotatePoint(centerX, maxY, centerX, centerY, rotation), // 下中
      rotatePoint(minX, maxY, centerX, centerY, rotation), // 左下
      rotatePoint(minX, centerY, centerX, centerY, rotation) // 左中
    ]

    // 检查每个锚点
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i]
      const dx = point.x - anchor.x
      const dy = point.y - anchor.y
      // 角点使用方形判定区域，边缘点使用圆形判定区域
      if (i % 2 === 0) {
        // 方形判定（四角）
        if (Math.abs(dx) <= 6 && Math.abs(dy) <= 6) {
          return i
        }
      } else {
        // 圆形判定（边缘中点）
        if (Math.sqrt(dx * dx + dy * dy) <= 6) {
          return i
        }
      }
    }
    return null
  }

  /**
   * 绘制框选区域
   * 1. 计算框选区域的边界坐标
   * 2. 绘制半透明的蓝色填充背景
   * 3. 绘制虚线选择边框
   */
  const drawSelectionBox = () => {
    if (!ctx.value || !selectionBox.value) return
    const { start, end } = selectionBox.value
    // 计算框选区域的左上角和右下角坐标
    const minX = Math.min(start.x, end.x)
    const minY = Math.min(start.y, end.y)
    const maxX = Math.max(start.x, end.x)
    const maxY = Math.max(start.y, end.y)

    ctx.value.save()
    // 绘制半透明蓝色背景
    ctx.value.globalAlpha = 0.12
    ctx.value.fillStyle = '#1976d2'
    ctx.value.fillRect(minX, minY, maxX - minX, maxY - minY)

    // 绘制虚线边框
    ctx.value.globalAlpha = 1
    ctx.value.strokeStyle = '#1976d2'
    ctx.value.lineWidth = 1.5
    ctx.value.setLineDash([6, 4]) // 设置虚线样式
    ctx.value.strokeRect(minX, minY, maxX - minX, maxY - minY)
    ctx.value.setLineDash([]) // 恢复实线
    ctx.value.restore()
  }

  /**
   * 重绘整个画布
   * 1. 清空画布内容
   * 2. 遍历绘制所有图形元素
   * 3. 为选中的元素绘制锚点
   * 4. 如果处于框选状态则绘制选区
   */
  const redrawCanvas = () => {
    if (!ctx.value || !canvasRef.value) return
    // 每次操作需要清空画布并重新绘制
    // 清空画布
    ctx.value.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height)
    // 绘制所有图形元素
    store.elements.forEach(el => {
      drawElement(el, selectedIds.value.includes(el.id))
    })
    // 多选时为每个选中元素绘制锚点
    selectedElements.value.forEach(el => drawAnchors(el))
    // 框选时绘制选区
    if (selectionBox.value) drawSelectionBox()
  }

  /**
   * 处理鼠标按下事件
   * 1. 保存历史记录
   * 2. 获取鼠标点击的画布坐标
   * 3. 根据当前工具进行不同处理:
   *    - select工具: 处理选择、拖动、缩放和旋转
   *    - 其他绘图工具: 开始绘制新元素
   */
  const handleMouseDown = (e: MouseEvent) => {
    if (!canvasRef.value) return
    safePushHistory()
    // 获取鼠标点击的画布坐标
    const rect = canvasRef.value.getBoundingClientRect()
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }

    if (store.currentTool === 'text') {
      isDrawing.value = true
      startPoint.value = point
      const newElement = {
        id: nanoid(),
        type: store.currentTool,
        points: [point, point],
        color: store.color,
        strokeWidth: store.strokeWidth,
        text: ''
      }
      store.addElement(newElement)
      selectedIds.value = [newElement.id]
    } else if (store.currentTool === 'select') {
      // 检查是否点击了选中元素的锚点
      if (selectedIds.value.length === 1) {
        const selected = selectedElements.value[0]
        if (selected) {
          // 检查是否点击了旋转锚点
          if (isOnRotateAnchor(point, selected)) {
            rotating.value = true
            const [start, end] = selected.points
            const centerX = (start.x + end.x) / 2
            const centerY = (start.y + end.y) / 2
            // 计算旋转起始角度和初始旋转值
            rotateStartAngle.value = Math.atan2(point.y - centerY, point.x - centerX)
            rotateStartRotation.value = selected.rotation || 0
            startPoint.value = point
            return
          }
          // 检查是否点击了缩放锚点
          const anchorIndex = hitAnchorPoint(point, selected)
          if (anchorIndex !== null) {
            resizing.value = true
            resizeAnchor.value = anchorIndex
            startPoint.value = point
            return
          }
        }
      }
      // 检查是否点击了任意图形
      let hitAny = false
      for (let i = store.elements.length - 1; i >= 0; i--) {
        const el = store.elements[i]
        // 检查鼠标点击的坐标是否在当前图形元素内部
        // hitTestPointInElement 函数用于判断一个点是否在图形内部，point 是鼠标点击的坐标, el 是当前遍历到的图形元素
        if (hitTestPointInElement(point, el)) {
          if (selectedIds.value.length > 1 && selectedIds.value.includes(el.id)) {
            // 当前处于多选状态(selectedIds长度>1)且点击的是已选中图形之一
            // 此时需要准备拖动所有选中的图形
            // 计算拖动偏移量:以第一个选中图形的起始点为基准
            dragOffset.value = {
              x: point.x - selectedElements.value[0].points[0].x,
              y: point.y - selectedElements.value[0].points[0].y
            }
            // 记录拖动起始点
            startPoint.value = point
          } else {
            // 以下两种情况之一:
            // 1. 当前是单选状态(selectedIds长度为0或1)
            // 2. 当前是多选状态,但点击了未被选中的图形
            // 此时需要切换为仅选中当前点击的图形
            selectedIds.value = [el.id]
            // 计算拖动偏移量:以当前图形的起始点为基准
            dragOffset.value = {
              x: point.x - el.points[0].x,
              y: point.y - el.points[0].y
            }
            // 记录拖动起始点
            startPoint.value = point
          }
          // 标记已命中图形,防止进入框选逻辑
          hitAny = true
          break
        }
      }
      // 如果未命中任何图形,则开始框选
      if (!hitAny) {
        // 点击空白处,开始框选
        selectionBox.value = { start: point, end: point }
        startPoint.value = point
        dragOffset.value = null
        selectedIds.value = []
      }
    } else {
      // 开始绘制新元素
      // 判断当前工具是否是 铅笔 工具
      if (store.currentTool === 'freehand') selectedIds.value = [] // 自由绘制时清除选中状态
      isDrawing.value = true
      startPoint.value = point
      // 创建新元素
      const newElement = {
        id: nanoid(),
        type: store.currentTool,
        points: [point, point],
        color: store.color,
        strokeWidth: store.strokeWidth
      }
      store.addElement(newElement)
      // 非自由绘制时自动选中新元素
      if (store.currentTool !== 'freehand') {
        selectedIds.value = [newElement.id]
      }
    }
  }

  /**
   * 检测点是否在图形元素内部
   * @param point 要检测的点坐标
   * @param element 要检测的图形元素
   * @returns 点是否在图形内部
   */
  function hitTestPointInElement(point: Point, element: DrawingElement) {
    // 考虑元素的旋转角度
    const rotation = element.rotation || 0
    const [start, end] = element.points
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    // 如果有旋转，先将点反向旋转到元素的坐标系中
    let testPoint = point
    if (rotation !== 0) {
      testPoint = unrotatePoint(point.x, point.y, centerX, centerY, rotation)
    }

    if (element.type === 'text') {
      return testPoint.x >= minX && testPoint.x <= maxX && testPoint.y >= minY && testPoint.y <= maxY
    } else if (element.type === 'rectangle') {
      // 矩形:检查点是否在矩形的边界框内
      return testPoint.x >= minX && testPoint.x <= maxX && testPoint.y >= minY && testPoint.y <= maxY
    } else if (element.type === 'ellipse') {
      // 椭圆:使用椭圆方程检查点是否在椭圆内
      const rx = Math.abs(end.x - start.x) / 2 // x轴半径
      const ry = Math.abs(end.y - start.y) / 2 // y轴半径
      if (rx === 0 || ry === 0) return false
      return (testPoint.x - centerX) ** 2 / rx ** 2 + (testPoint.y - centerY) ** 2 / ry ** 2 <= 1
    } else if (element.type === 'diamond') {
      // 检测点是否在棱形内部
      const width = Math.abs(end.x - start.x)
      const height = Math.abs(end.y - start.y)

      // 将点相对于中心点进行标准化
      const dx = Math.abs(testPoint.x - centerX)
      const dy = Math.abs(testPoint.y - centerY)

      // 使用棱形的方程检查点是否在内部
      return dx / (width / 2) + dy / (height / 2) <= 1
    } else if (element.type === 'line') {
      // 直线:计算点到直线的距离,小于阈值则认为点在线上
      // 对于线条，我们需要处理特殊情况，因为线条的起点和终点在旋转后也会变化
      let lineStart, lineEnd
      if (rotation !== 0) {
        lineStart = rotatePoint(start.x, start.y, centerX, centerY, rotation)
        lineEnd = rotatePoint(end.x, end.y, centerX, centerY, rotation)
        // 对于线条，使用原始点进行测试，因为我们已经旋转了线条本身
        testPoint = point
      } else {
        lineStart = start
        lineEnd = end
      }

      const dist =
        Math.abs(
          (lineEnd.y - lineStart.y) * testPoint.x -
            (lineEnd.x - lineStart.x) * testPoint.y +
            lineEnd.x * lineStart.y -
            lineEnd.y * lineStart.x
        ) / Math.sqrt((lineEnd.y - lineStart.y) ** 2 + (lineEnd.x - lineStart.x) ** 2)
      return dist < 8 // 距离阈值为8像素
    } else if (element.type === 'freehand') {
      // 自由绘制:检查点到所有线段的最短距离
      // 由于freehand是多点曲线，旋转处理更复杂，这里暂时以简化方式处理
      const pts = element.points
      let rotatedPts = pts

      // 如果有旋转，计算旋转后的所有点
      if (rotation !== 0) {
        rotatedPts = pts.map(pt => rotatePoint(pt.x, pt.y, centerX, centerY, rotation))
        // 对于自由绘制曲线，使用原始点进行测试
        testPoint = point
      }

      for (let i = 0; i < rotatedPts.length - 1; i++) {
        const a = rotatedPts[i] // 当前线段起点
        const b = rotatedPts[i + 1] // 当前线段终点
        // 计算点到线段的投影
        const A = testPoint.x - a.x
        const B = testPoint.y - a.y
        const C = b.x - a.x
        const D = b.y - a.y
        const dot = A * C + B * D
        const len_sq = C * C + D * D
        let param = -1
        if (len_sq !== 0) param = dot / len_sq
        // 计算点到线段的最近点
        let xx, yy
        if (param < 0) {
          // 投影在线段外部(起点侧)
          xx = a.x
          yy = a.y
        } else if (param > 1) {
          // 投影在线段外部(终点侧)
          xx = b.x
          yy = b.y
        } else {
          // 投影在线段内部
          xx = a.x + param * C
          yy = a.y + param * D
        }
        // 计算点到最近点的距离
        const dx = testPoint.x - xx
        const dy = testPoint.y - yy
        if (Math.sqrt(dx * dx + dy * dy) < 8) return true // 距离小于8像素则命中
      }
      return false
    }
    return false
  }

  /**
   * 处理鼠标移动事件
   * 主要功能:
   * 1. 处理元素旋转
   * 2. 处理框选区域更新
   * 3. 处理锚点悬停高亮
   * 4. 处理元素大小调整
   * 5. 处理多选拖动
   * 6. 处理绘制过程中的实时更新
   * @param e 鼠标事件对象
   */
  const handleMouseMove = (e: MouseEvent) => {
    if (!canvasRef.value) return
    // 获取鼠标相对于画布的坐标
    const rect = canvasRef.value.getBoundingClientRect()
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }

    // 处理元素旋转
    if (rotating.value && selectedIds.value.length === 1) {
      const selected = selectedElements.value[0]
      if (selected) {
        // 计算旋转中心点
        const [start, end] = selected.points
        const centerX = (start.x + end.x) / 2
        const centerY = (start.y + end.y) / 2
        // 计算当前鼠标位置与中心点的角度
        const angle = Math.atan2(point.y - centerY, point.x - centerX)
        // 更新元素旋转角度
        selected.rotation = rotateStartRotation.value + (angle - rotateStartAngle.value)
        redrawCanvas()
      }
      return
    }

    // 处理框选区域更新
    if (selectionBox.value && startPoint.value) {
      selectionBox.value.end = point
      redrawCanvas()
      return
    }

    // 处理锚点悬停高亮
    if (store.currentTool === 'select' && selectedIds.value.length === 1 && !resizing.value) {
      const selected = selectedElements.value[0]
      if (selected) {
        hoverAnchor.value = hitAnchorPoint(point, selected)
      }
    } else {
      hoverAnchor.value = null
    }

    if (store.currentTool === 'select') {
      // 处理元素大小调整
      if (resizing.value && selectedIds.value.length === 1 && startPoint.value) {
        const selected = selectedElements.value[0]
        if (selected && resizeAnchor.value !== null) {
          resizeElementWithRotation(selected, resizeAnchor.value, point)
          selected.points = [...selected.points]
          redrawCanvas()
        }
      }
      // 处理多选拖动
      else if (selectedIds.value.length > 0 && startPoint.value && dragOffset.value) {
        const dx = point.x - startPoint.value.x
        const dy = point.y - startPoint.value.y
        selectedElements.value.forEach(el => {
          const newPoints = el.points.map(p => ({
            x: p.x + dx,
            y: p.y + dy
          }))
          el.points = [...newPoints]
        })
        startPoint.value = point
        redrawCanvas()
      }
    }
    // 处理绘制过程中的实时更新
    else if (isDrawing.value && startPoint.value) {
      const currentElement = store.elements[store.elements.length - 1]
      if (currentElement) {
        if (currentElement.type === 'freehand') {
          // 自由绘制模式下，持续添加新的点
          currentElement.points = [...currentElement.points, point]
        } else {
          // 其他图形模式下，只需要起点和终点
          currentElement.points = [startPoint.value, point]
        }
        redrawCanvas()
      }
    }
  }

  /**
   * 处理带旋转的元素缩放
   * @param element 要缩放的元素
   * @param anchorIdx 锚点索引
   * @param to 鼠标当前位置
   */
  function resizeElementWithRotation(element: DrawingElement, anchorIdx: number, to: Point) {
    if (element.type === 'line') {
      const [start, end] = element.points
      const rotation = element.rotation || 0
      const centerX = (start.x + end.x) / 2
      const centerY = (start.y + end.y) / 2

      // 如果有旋转，需要在旋转的坐标系中处理
      if (rotation !== 0) {
        // 将鼠标位置转换到未旋转的坐标系
        const unrotatedPoint = unrotatePoint(to.x, to.y, centerX, centerY, rotation)
        // 移动对应的端点
        if (anchorIdx === 0) {
          element.points[0] = unrotatedPoint
        } else {
          element.points[1] = unrotatedPoint
        }
      } else {
        // 没有旋转时直接移动端点
        if (anchorIdx === 0) {
          element.points[0] = to
        } else {
          element.points[1] = to
        }
      }
      return
    }

    // 其他图形的缩放逻辑
    const [start, end] = element.points
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    const width = maxX - minX
    const height = maxY - minY
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const rotation = element.rotation || 0

    // 如果没有旋转，使用常规缩放方法
    if (rotation === 0) {
      resizeElement(element, anchorIdx, to)
      return
    }

    // 计算初始锚点位置（未旋转状态）
    const anchors = [
      { x: minX, y: minY }, // 左上
      { x: centerX, y: minY }, // 上中
      { x: maxX, y: minY }, // 右上
      { x: maxX, y: centerY }, // 右中
      { x: maxX, y: maxY }, // 右下
      { x: centerX, y: maxY }, // 下中
      { x: minX, y: maxY }, // 左下
      { x: minX, y: centerY } // 左中
    ]

    // 计算旋转后的锚点位置
    const rotatedAnchors = anchors.map(a => rotatePoint(a.x, a.y, centerX, centerY, rotation))

    // 确定缩放操作的对立锚点（用作缩放的固定点）
    const oppositeIdx = (anchorIdx + 4) % 8
    const oppositeAnchor = rotatedAnchors[oppositeIdx]
    const currentAnchor = rotatedAnchors[anchorIdx]

    // 1. 计算原始尺寸（旋转前）
    const originalWidth = maxX - minX
    const originalHeight = maxY - minY

    // 2. 记录起始状态，用于增量计算
    if (!startPoint.value) return

    // 计算鼠标移动的增量向量
    const mouseDeltaX = to.x - startPoint.value.x
    const mouseDeltaY = to.y - startPoint.value.y

    // 如果是首次调用，保存初始数据
    if (!dragOffset.value) {
      dragOffset.value = { x: 0, y: 0 }
    }

    // 更新开始点位置，为下一次移动做准备
    startPoint.value = to

    // 3. 基于锚点的类型，确定缩放方式
    let scaleChangeX = 0
    let scaleChangeY = 0

    if (anchorIdx === 0 || anchorIdx === 2 || anchorIdx === 4 || anchorIdx === 6) {
      // 角锚点 - 同时缩放X和Y
      // 计算锚点和对立锚点之间的向量
      const anchorToOppositeX = oppositeAnchor.x - currentAnchor.x
      const anchorToOppositeY = oppositeAnchor.y - currentAnchor.y
      const anchorToOppositeLength = Math.sqrt(
        anchorToOppositeX * anchorToOppositeX + anchorToOppositeY * anchorToOppositeY
      )

      // 计算鼠标移动向量在锚点方向上的投影长度
      const projectionLength =
        (mouseDeltaX * anchorToOppositeX + mouseDeltaY * anchorToOppositeY) / anchorToOppositeLength

      // 根据投影方向和距离计算缩放变化量
      const direction = -Math.sign(anchorToOppositeX * mouseDeltaX + anchorToOppositeY * mouseDeltaY)
      const changeAmount = Math.abs(projectionLength) / 100 // 调整缩放速率

      // 应用增量式缩放因子，避免突变
      scaleChangeX = direction * changeAmount
      scaleChangeY = direction * changeAmount
    } else if (anchorIdx === 1 || anchorIdx === 5) {
      // 上下中点 - 只缩放Y
      const anchorToOppositeY = oppositeAnchor.y - currentAnchor.y
      const direction = -Math.sign(anchorToOppositeY * mouseDeltaY)
      const changeAmount = Math.abs(mouseDeltaY) / 100 // 调整缩放速率

      scaleChangeY = direction * changeAmount
    } else if (anchorIdx === 3 || anchorIdx === 7) {
      // 左右中点 - 只缩放X
      const anchorToOppositeX = oppositeAnchor.x - currentAnchor.x
      const direction = -Math.sign(anchorToOppositeX * mouseDeltaX)
      const changeAmount = Math.abs(mouseDeltaX) / 100 // 调整缩放速率

      scaleChangeX = direction * changeAmount
    }

    // 4. 根据缩放变化量调整元素的宽高
    // 使用更温和的缩放方式
    let newWidth = originalWidth * (1 + scaleChangeX)
    let newHeight = originalHeight * (1 + scaleChangeY)

    // 设置最小尺寸限制
    newWidth = Math.max(10, newWidth)
    newHeight = Math.max(10, newHeight)

    // 5. 根据新的尺寸计算元素的新边界
    const halfNewWidth = newWidth / 2
    const halfNewHeight = newHeight / 2

    // 6. 设置新的起点和终点
    element.points = [
      { x: centerX - halfNewWidth, y: centerY - halfNewHeight },
      { x: centerX + halfNewWidth, y: centerY + halfNewHeight }
    ]
  }

  /**
   * 处理鼠标松开事件
   * 主要功能:
   * 1. 处理图形绘制完成后的自动选中
   * 2. 重置各种状态值(绘制、调整大小、旋转等)
   * 3. 处理框选结束后的批量选中
   * 4. 自动切换到选择工具
   * 5. 记录历史状态
   */
  const handleMouseUp = () => {
    if (isDrawing.value && store.currentTool === 'text' && store.elements.length > 0) {
      const element = store.elements[store.elements.length - 1]
      if (element.type === 'text') {
        const [start, end] = element.points
        textInput.value = {
          visible: true,
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
          content: '',
          rotation: element.rotation || 0
        }
        nextTick(() => {
          if (textareaRef.value) {
            textareaRef.value.focus()
          }
        })
      }
    }

    // 如果是刚画完图形，且不是 freehand，自动选中最后一个
    if (isDrawing.value && store.elements.length > 0 && store.currentTool !== 'freehand') {
      const lastId = store.elements[store.elements.length - 1].id
      selectedIds.value = [lastId]
    }

    // 重置所有状态值
    isDrawing.value = false // 绘制状态
    resizing.value = false // 调整大小状态
    rotateStartAngle.value = 0 // 开始旋转角度
    rotateStartRotation.value = 0 // 元素初始旋转角度
    rotating.value = false // 旋转状态
    resizeAnchor.value = null // 调整大小的锚点
    dragOffset.value = null // 拖动偏移量

    // 框选结束，批量选中框内元素
    if (selectionBox.value) {
      selectElementsInBox(selectionBox.value.start, selectionBox.value.end)
      selectionBox.value = null
    }

    startPoint.value = null // 清除起始点

    // 只有非 freehand 工具时自动切换到选择工具
    if (store.currentTool !== 'select' && store.currentTool !== 'freehand') {
      store.setCurrentTool('select')
    }

    // 如果有任何图形变更(绘制/调整大小/拖动)，记录历史状态
    if (!selectionBox.value && (isDrawing.value || resizing.value || dragOffset.value)) {
      pushHistory()
    }
  }

  /**
   * 处理键盘按键事件
   * @param e 键盘事件对象
   */
  function handleKeyDown(e: KeyboardEvent) {
    // 如果正在编辑文本，不处理删除操作
    if (textInput.value.visible) {
      return
    }

    // 当按下删除键或退格键，且有选中元素时
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.value.length > 0) {
      // 先保存历史记录
      pushHistory()
      // 删除所有选中的元素
      selectedIds.value.forEach(id => store.deleteElement(id))
      // 清空选中状态
      selectedIds.value = []
      // 重新绘制画布
      redrawCanvas()
    }
    // 按下 Ctrl/Command + Z 执行撤销操作
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undo()
    }
    // 按下 Ctrl/Command + Y 执行恢复操作
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      redo()
    }
  }

  // 完成文本输入
  function completeTextInput() {
    if (!textInput.value.visible) return

    const currentElement = store.elements[store.elements.length - 1]
    if (currentElement && currentElement.type === 'text') {
      currentElement.text = textInput.value.content
      selectedIds.value = [currentElement.id]
    }

    textInput.value.visible = false
    textInput.value.content = ''
    redrawCanvas()
  }

  /**
   * 处理双击事件
   * 如果双击的是文本元素，则进入编辑模式
   */
  function handleDoubleClick(e: MouseEvent) {
    if (!canvasRef.value) return
    const rect = canvasRef.value.getBoundingClientRect()
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }

    // 检查是否点击了文本元素
    for (let i = store.elements.length - 1; i >= 0; i--) {
      const element = store.elements[i]
      if (element.type === 'text' && hitTestPointInElement(point, element)) {
        // 设置文本输入框的位置和内容
        const [start, end] = element.points
        textInput.value = {
          visible: true,
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
          content: element.text || '',
          rotation: element.rotation || 0
        }

        // 选中当前元素
        selectedIds.value = [element.id]

        // 聚焦文本输入框
        nextTick(() => {
          if (textareaRef.value) {
            textareaRef.value.focus()
          }
        })
        break
      }
    }
  }

  onMounted(() => {
    initCanvas()
    window.addEventListener('resize', initCanvas)
    // 监听键盘删除
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', initCanvas)
    window.removeEventListener('keydown', handleKeyDown)
  })

  watch(() => store.elements, redrawCanvas, { deep: true })
  watch(selectedIds, redrawCanvas)
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

  .text-input-container {
    position: absolute;
    pointer-events: none;

    textarea {
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
      resize: none;
      outline: none;
      font-family: Arial, sans-serif;
      padding: 8px;
      margin: 0;
      pointer-events: auto;
      overflow: auto; // 改为 auto 允许滚动
      box-sizing: border-box;
      line-height: 1.2;
      white-space: pre-wrap;
      word-wrap: break-word;
      word-break: break-all; // 添加这个属性确保所有文字都会换行
    }
  }
</style>
