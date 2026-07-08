/**
 * Central user-feedback API — maps to toast vs banner vs inline rules.
 *
 * TOAST (this module only):
 * - Action completed — user moves on (saved, exported, deleted)
 * - Recoverable one-off action failed (export PDF, upload)
 * - Cancelled / undoable low-stakes
 * - Brief access denied on redirect
 * - Background process finished (refresh complete)
 *
 * NOT TOAST — use PageAlert banner or inline UI instead:
 * - In-progress / resume / load-plan / partial-load progress
 * - Page-level load errors that block or guide retry on this page
 * - Form field validation
 * - Diagnostic warnings that persist until dismissed
 *
 * Import feedback from here — do not call toast.info/warning directly in pages.
 */
import { toast } from 'sonner';

export const feedback = {
  /** Action completed successfully. */
  actionSuccess(message: string, options?: { duration?: number }) {
    toast.success(message, { duration: options?.duration ?? 4000 });
  },

  /** Single recoverable action failed (export, upload, etc.). */
  actionFailed(message: string, options?: { description?: string; duration?: number }) {
    toast.error(message, {
      description: options?.description,
      duration: options?.duration ?? 5000,
    });
  },

  /** User cancelled a reversible operation. */
  cancelled(message: string) {
    toast.info(message, { duration: 3000 });
  },

  /** Brief notice when user lacks page access. */
  accessDenied(message = 'You do not have access to this page.') {
    toast.error(message, { duration: 4000 });
  },

  /** Long-running background task started — returns id for dismiss/update. */
  loading(message: string) {
    return toast.loading(message);
  },

  /** Update an existing loading toast message. */
  loadingUpdate(id: string | number, message: string) {
    toast.loading(message, { id });
  },

  /** Replace a loading toast with success. */
  loadingSuccess(id: string | number, message: string, options?: { duration?: number }) {
    toast.success(message, { id, duration: options?.duration ?? 5000 });
  },

  /** Replace a loading toast with error. */
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

  /** Update or dismiss a loading toast by id. */
  dismiss(id: string | number | undefined) {
    if (id != null) toast.dismiss(id);
  },

  /** Background refresh / sync finished. */
  refreshed(message = 'Report refreshed') {
    toast.success(message, { duration: 3000 });
  },

  /** Background incremental update (low-stakes). */
  backgroundUpdate(message: string) {
    toast.success(message, { duration: 3000 });
  },
};
