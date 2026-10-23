// A tiny toast store: toast.success('Saved') from anywhere, <Toaster /> shows them.
let toasts = [];
let nextId = 1;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

function show(type, message) {
  const id = nextId++;
  toasts = [...toasts, { id, type, message }];
  emit();
  setTimeout(() => dismiss(id), type === 'error' ? 6000 : 3500);
}

export function dismiss(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToToasts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getToasts = () => toasts;

export const toast = {
  success: (message) => show('success', message),
  error: (message) => show('error', message),
};
