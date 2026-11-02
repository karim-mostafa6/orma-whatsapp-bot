import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/cairo';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
