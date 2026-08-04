import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { installAnimations } from './canvas/animations.js';
import { Canvas } from './canvas/Canvas.js';
import { FilterBar } from './panels/FilterBar.js';
import { Toolbar } from './panels/Toolbar.js';
import { markReady } from './runtime/api.js';

export function App() {
  useEffect(() => {
    installAnimations();
    markReady();
  }, []);

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        <FilterBar />
        <main className="app__body">
          <Canvas />
        </main>
      </div>
    </ReactFlowProvider>
  );
}
