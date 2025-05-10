import { defineStore } from 'pinia'
import type { DrawingElement, DrawingState } from '../types/drawing'

export const useDrawingStore = defineStore('drawing', {
  state: (): DrawingState => ({
    elements: [],
    selectedElement: null,
    currentTool: 'select',
    color: '#000000',
    strokeWidth: 2
  }),

  actions: {
    addElement(element: DrawingElement) {
      this.elements.push(element)
    },

    updateElement(id: string, updates: Partial<DrawingElement>) {
      const element = this.elements.find(el => el.id === id)
      if (element) {
        Object.assign(element, updates)
      }
    },

    deleteElement(id: string) {
      const index = this.elements.findIndex(el => el.id === id)
      if (index !== -1) {
        this.elements.splice(index, 1)
      }
    },

    setCurrentTool(tool: DrawingState['currentTool']) {
      this.currentTool = tool
    },

    setColor(color: string) {
      this.color = color
    },

    setStrokeWidth(width: number) {
      this.strokeWidth = width
    },

    clearCanvas() {
      this.elements = []
      this.selectedElement = null
    }
  }
})
