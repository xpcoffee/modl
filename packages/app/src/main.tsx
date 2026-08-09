import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installMotion } from './canvas/motion.js';
import { installRuntimeApi } from './runtime/api.js';
import './styles.css';

installRuntimeApi();
// Before the first render, so an element created in the first frame warps
// the way the reader's preference says it should.
installMotion();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
