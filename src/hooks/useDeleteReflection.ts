import { useCallback, useRef, useState } from "react";

import { canDeleteNow } from "@/data/journalRepository";
import { deleteReflection } from "@/services/entryDeletion";

export type DeleteTarget = { entryId: string; answered: boolean };

// What DeleteReflectionDialog is given.
export type DeleteReflectionDialogState = {
  visible: boolean;
  // The reflection is an answered prayer: deleting it also deletes the gratitude note, and the dialog says so.
  answered: boolean;
  running: boolean;
  failed: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// The state of the "Delete this reflection forever?" dialog, shared by Prayers and Reflection (step 29b).
// - ask(target) opens the dialog and answers true; with no connection nothing opens and it answers false, so the screen can say
//   why (a delete is online only: nothing is queued for later).
// - Confirming deletes through the service; success closes the dialog and calls onDeleted with the entry id, a failure keeps the
//   dialog open with `failed` set, and the confirm button is the retry.
// - One delete at a time, and the dialog cannot be closed while one is on its way.
export function useDeleteReflection(onDeleted: (entryId: string) => void): {
  ask: (target: DeleteTarget) => boolean;
  dialog: DeleteReflectionDialogState;
} {
  // The target stays after the dialog closes, so its words do not change while it fades out.
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const ask = useCallback((next: DeleteTarget): boolean => {
    if (!canDeleteNow()) return false;
    setFailed(false);
    setTarget(next);
    setOpen(true);
    return true;
  }, []);

  const cancel = useCallback(() => {
    if (busy.current) return;
    setOpen(false);
  }, []);

  const confirm = useCallback(async () => {
    if (target === null || busy.current) return;
    busy.current = true;
    setRunning(true);
    setFailed(false);
    const result = await deleteReflection(target.entryId);
    busy.current = false;
    setRunning(false);
    if (result.ok) {
      setOpen(false);
      onDeleted(target.entryId);
    } else {
      setFailed(true);
    }
  }, [target, onDeleted]);

  return {
    ask,
    dialog: {
      visible: open,
      answered: target?.answered ?? false,
      running,
      failed,
      onConfirm: confirm,
      onCancel: cancel,
    },
  };
}
