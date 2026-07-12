import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './app/product.css';
import './app/navigation.css';

const root = document.getElementById('root');
if (root === null) throw new Error('ATLAS X root element is missing');
createRoot(root).render(<StrictMode><App /></StrictMode>);
