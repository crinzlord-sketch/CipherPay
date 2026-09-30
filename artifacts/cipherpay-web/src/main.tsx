const savedCipherPayTheme = typeof window !== "undefined" ? window.localStorage.getItem("cipherpay_theme") : null;
if (typeof document !== "undefined") {
  const dark = savedCipherPayTheme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { setBaseUrl } from '@workspace/api-client-react';

import './index.css';

// Apply the saved theme before React paints so every page switches together.
if (typeof document !== 'undefined') {
  const savedTheme = window.localStorage.getItem('cipherpay_theme');
  document.documentElement.classList.toggle('dark', savedTheme === 'dark');
  document.documentElement.style.colorScheme = savedTheme === 'dark' ? 'dark' : 'light';
}

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'https://cipherpay-api.onrender.com';
setBaseUrl(apiBaseUrl);

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
