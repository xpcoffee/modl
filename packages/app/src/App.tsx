import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas.js';
import { FilterBar } from './panels/FilterBar.js';
import { Inspector } from './panels/Inspector.js';
import { Toolbar } from './panels/Toolbar.js';
import { markReady } from './runtime/api.js';

export function App() {
  useEffect(markReady, []);

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        <FilterBar />
        <main className="app__body">
          <Canvas />
          <Inspector />
        </main>
      </div>
    </ReactFlowProvider>
  );
}
