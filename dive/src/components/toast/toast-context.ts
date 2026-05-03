import { createContext, useContext } from "react";

export type ToastVariant = "success" | "info" | "warn" | "error";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ToastContextValue {
  toast: (t: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: () => "",
      dismiss: () => {},
    };
  }
  return ctx;
}
