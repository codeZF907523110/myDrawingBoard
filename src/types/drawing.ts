export interface Point {
  x: number;
  y: number;
}

export type DrawingTool =
  | "select"
  | "rectangle"
  | "ellipse"
  | "line"
  | "text"
  | "freehand";

export interface DrawingElement {
  id: string;
  type: Exclude<DrawingTool, "select">;
  points: Point[];
  color: string;
  strokeWidth: number;
  rotation?: number;
  isSelected?: boolean;
}

export interface DrawingState {
  elements: DrawingElement[];
  selectedElement: DrawingElement | null;
  currentTool: DrawingTool;
  color: string;
  strokeWidth: number;
}
