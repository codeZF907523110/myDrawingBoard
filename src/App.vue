<script setup lang="ts">
import Toolbar from './components/Toolbar.vue';
import DrawingCanvas from './components/DrawingCanvas.vue';
</script>

<template>
  <div class="app">
    <Toolbar />
    <div class="canvas-area">
      <DrawingCanvas />
    </div>
  </div>
</template>

<style lang="scss">
@import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css');

html, body, #app, .app {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  background: #f7f8fa;
  color: #222;
}

.app {
  min-height: 100vh;
  min-width: 100vw;
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  background: #f7f8fa;
}

.canvas-area {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.canvas-area > * {
  width: 90vw;
  height: 80vh;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 4px 24px 0 rgba(60, 60, 60, 0.08), 0 1.5px 4px 0 rgba(60, 60, 60, 0.04);
  overflow: hidden;
}
</style>
