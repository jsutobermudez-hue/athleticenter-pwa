"use client"

import { useState, useEffect } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

// Sistema simple de eventos para disparar notificaciones desde cualquier lugar
const listeners = new Set<(toast: ToastMessage) => void>();

export function toast(message: string, type: ToastType = 'info') {
  const id = Math.random().toString(36).substring(2, 9);
  listeners.forEach((listener) => listener({ id, message, type }));
}

// Componente visual que se monta en el layout
export function Toaster() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handler = (newToast: ToastMessage) => {
      setToasts((prev) => [...prev, newToast]);
      // Auto-eliminar después de 4 segundos
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
      }, 4000);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div 
          key={t.id} 
          className={`pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium animate-in slide-in-from-right-full transition-all ${
            t.type === 'error' ? 'bg-red-600' : 
            t.type === 'success' ? 'bg-green-600' : 'bg-slate-800'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}