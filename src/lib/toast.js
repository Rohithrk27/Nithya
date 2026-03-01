export function emitToast(text, options = {}) {
  if (typeof window === 'undefined') return;
  if (!text) return;
  window.dispatchEvent(new CustomEvent('nithya-toast', {
    detail: {
      text: String(text),
      ttl: Number(options.ttl || 3200),
    },
  }));
}

export const toastSuccess = (text, options = {}) => emitToast(text, { ttl: 2800, ...options });
export const toastInfo = (text, options = {}) => emitToast(text, options);
export const toastError = (text, options = {}) => emitToast(text, { ttl: 4200, ...options });
