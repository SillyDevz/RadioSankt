import React from 'react';
import ReactDOM from 'react-dom/client';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Layout />
    </ErrorBoundary>
  </React.StrictMode>,
);
