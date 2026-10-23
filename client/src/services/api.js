import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hireboard_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // A wrong password on the login form is also a 401; let the form show its error.
    const isAuthForm = /\/auth\/(login|register)$/.test(error.config?.url || '');
    if (error.response?.status === 401 && !isAuthForm) {
      localStorage.removeItem('hireboard_token');
      localStorage.removeItem('hireboard_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// A readable message from a failed request. The API answers
// { error: { message, fields } }; a field message is more specific, so prefer it.
export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
  const error = err.response?.data?.error;
  if (!error) return err.response ? fallback : 'Cannot reach the server. Please try again in a minute.';
  if (typeof error === 'string') return error;
  const firstField = error.fields && Object.values(error.fields)[0];
  return firstField || error.message || fallback;
}
