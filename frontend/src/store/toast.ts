// =============================================================================
// Toast store
// =============================================================================
//
// Global so a transaction hook can report without knowing which page it is
// on. Rendered once by `ToastContainer` in the root layout.

import { create } from "zustand";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title?: string;
  message: string;
  /** Milliseconds before auto-dismiss. */
  duration: number;
  /** Optional link rendered under the message, typically an explorer URL. */
  link?: { href: string; label: string };
}

interface ToastStore {
  toasts: Toast[];
  add: (toast: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let nextId = 0;

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 5_000,
  error: 7_000,
  warning: 5_000,
  info: 4_000,
};

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = `toast-${++nextId}`;
    const duration = toast.duration ?? DEFAULT_DURATION[toast.variant];
    set((state) => ({ toasts: [...state.toasts.slice(-4), { ...toast, id, duration }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helpers usable outside React. */
export const toast = {
  success: (message: string, title?: string, link?: Toast["link"]) =>
    useToastStore.getState().add({ variant: "success", message, title, link }),
  error: (message: string, title?: string) =>
    useToastStore.getState().add({ variant: "error", message, title }),
  warning: (message: string, title?: string) =>
    useToastStore.getState().add({ variant: "warning", message, title }),
  info: (message: string, title?: string, duration?: number) =>
    useToastStore.getState().add({ variant: "info", message, title, duration }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};
