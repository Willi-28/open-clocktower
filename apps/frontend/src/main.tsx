/**
 * React application entry point.
 *
 * Vite loads this file in the browser, mounts the App component, and imports
 * the global stylesheet used by the full Open Clocktower interface.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
