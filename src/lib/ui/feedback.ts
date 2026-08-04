/**
 * Toast API only — page load/progress/validation → PageAlert or inline, not toast.info/warning in pages.
 */
import { toast } from 'sonner';

export const feedback = {
  actionSuccess(message: string, options?: { duration?: number }) {
    toast.success(message, { duration: options?.duration ?? 4000 });
  },

  actionFailed(message: string, options?: { description?: string; duration?: number }) {
    toast.error(message, {
      description: options?.description,
      duration: options?.duration ?? 5000,
    });
  },

  actionWarning(message: string, options?: { description?: string; duration?: number }) {
    toast.warning(message, {
      description: options?.description,
      duration: options?.duration ?? 8000,
    });
  },

  cancelled(message: string) {
    toast.info(message, { duration: 3000 });
  },

  accessDenied(message = 'You do not have access to this page.') {
    toast.error(message, { duration: 4000 });
  },

  loading(message: string) {
    return toast.loading(message);
  },

  loadingUpdate(id: string | number, message: string) {
    toast.loading(message, { id });
  },

  loadingSuccess(id: string | number, message: string, options?: { duration?: number }) {
    toast.success(message, { id, duration: options?.duration ?? 5000 });
  },

  loadingFailed(
    id: string | number,
    message: string,
    options?: { description?: string; duration?: number }
  ) {
    toast.error(message, {
      id,
      description: options?.description,
      duration: options?.duration ?? 6000,
    });
  },

  dismiss(id: string | number | undefined) {
    if (id != null) toast.dismiss(id);
  },

  refreshed(message = 'Report refreshed') {
    toast.success(message, { duration: 3000 });
  },

  backgroundUpdate(message: string) {
    toast.success(message, { duration: 3000 });
  },
};
