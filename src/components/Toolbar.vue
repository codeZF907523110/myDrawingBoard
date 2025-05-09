<template>
  <div class="toolbar">
    <div class="tool-group">
      <button
        v-for="tool in tools"
        :key="tool.name"
        :class="['tool-button', { active: store.currentTool === tool.name }]"
        @click="store.setCurrentTool(tool.name)"
        :title="tool.label"
      >
        <i :class="tool.icon"></i>
      </button>
    </div>

    <div class="tool-group color-group">
      <input
        type="color"
        :value="store.color"
        @input="e => store.setColor((e.target as HTMLInputElement).value)"
        title="选择颜色"
      />
      <input
        type="range"
        :min="1"
        :max="10"
        :value="store.strokeWidth"
        @input="e => store.setStrokeWidth(Number((e.target as HTMLInputElement).value))"
        title="线条粗细"
      />
    </div>

    <div class="tool-group">
      <button class="tool-button danger" @click="store.clearCanvas()" title="清空画布">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDrawingStore } from '../stores/drawing';

const store = useDrawingStore();

const tools = [
  { name: 'select', label: '选择', icon: 'fas fa-mouse-pointer' },
  { name: 'rectangle', label: '矩形', icon: 'fas fa-square' },
  { name: 'ellipse', label: '椭圆', icon: 'fas fa-circle' },
  { name: 'line', label: '直线', icon: 'fas fa-minus' },
  { name: 'freehand', label: '自由绘制', icon: 'fas fa-pen' }
];
</script>

<style scoped lang="scss">
.toolbar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.5rem 1.5rem;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 24px 0 rgba(60, 60, 60, 0.08), 0 1.5px 4px 0 rgba(60, 60, 60, 0.04);
  position: absolute;
  left: 50%;
  top: 32px;
  transform: translateX(-50%);
  z-index: 10;
  min-width: 420px;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f7f8fa;
  border-radius: 12px;
  padding: 0.25rem 0.5rem;
  box-shadow: 0 1px 2px 0 rgba(60, 60, 60, 0.03);
}

.color-group {
  gap: 1rem;
}

.tool-button {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  color: #444;
  transition: background 0.18s, color 0.18s, box-shadow 0.18s;
  box-shadow: none;

  &:hover {
    background: #e6e8eb;
    color: #1976d2;
  }
  &.active {
    background: #1976d2;
    color: #fff;
    box-shadow: 0 2px 8px 0 rgba(25, 118, 210, 0.08);
  }
  &.danger {
    color: #e53935;
    &:hover {
      background: #fdeaea;
      color: #b71c1c;
    }
  }
}

input[type="color"] {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 1px 2px 0 rgba(60, 60, 60, 0.04);
  cursor: pointer;
  padding: 0;
}

input[type="range"] {
  width: 80px;
  margin-left: 8px;
  accent-color: #1976d2;
}
</style> 