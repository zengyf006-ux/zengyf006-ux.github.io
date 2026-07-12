import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { PwaStatus } from './app/PwaStatus.js';
import { registerPwa } from './app/pwa.js';
import './app/product.css';
import './app/navigation.css';
import './app/market-runtime.css';
import './app/pwa.css';

const root = document.getElementById('root');
if (root === null) throw new Error('ATLAS X root element is missing');
createRoot(root).render(<StrictMode><App /><PwaStatus /></StrictMode>);
void registerPwa();
