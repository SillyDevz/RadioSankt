import React from 'react';
import ReactDOM from 'react-dom/client';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/globals.css';
import './i18n';

window.addEventListener('error', (event) => {
  console.error('[Unhandled Error]', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason);
});

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Layout />
    </ErrorBoundary>
  </React.StrictMode>,
);
