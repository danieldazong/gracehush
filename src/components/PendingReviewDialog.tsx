import { useState } from "react";
import { Pressable, Text } from "react-native";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { copy } from "@/constants/copy";
import type { HomeEntry } from "@/types";

const { review } = copy.journal;

type PendingReviewDialogProps = {
  // The card the person tapped "Review" on, or null while the dialog is closed.
  entry: HomeEntry | null;
  onClose: () => void;
  // Text only: opens New Entry with the same words and the same client entry id.
  onEdit: (clientEntryId: string) => void;
  onDelete: (clientEntryId: string) => Promise<void>;
};

// What a reflection that the server refused (a card with "Review") offers: read why, fix and send a written one
// again, or delete it. One ConfirmDialog with two steps, as on Profile: a second Modal opened from inside the first is
// the fragile case on iOS.
export function PendingReviewDialog({ entry, onClose, onEdit, onDelete }: PendingReviewDialogProps) {
  const [step, setStep] = useState<"review" | "delete">("review");
  const [busy, setBusy] = useState(false);
  // The content stays after the dialog closes, so the fade-out never shows an empty card. Kept in state and compared
  // during render, like the Journal's offline flag.
  const [kept, setKept] = useState<HomeEntry | null>(null);
  if (entry !== null && entry !== kept) {
    setKept(entry);
    setStep("review");
  }
  const shown = entry ?? kept;
  if (shown === null) return null;

  const isText = shown.inputType === "text";
  // Words that cannot be read (their key is gone) can only be deleted.
  const canEdit = isText && shown.pending?.lastErrorCode !== "UNREADABLE";

  async function confirmDelete() {
    if (busy || shown === null) return;
    setBusy(true);
    try {
      await onDelete(shown.clientEntryId ?? shown.id);
    } finally {
      setBusy(false);
    }
    onClose();
  }

  function confirm() {
    if (shown === null) return;
    if (step === "delete") {
      void confirmDelete();
    } else if (canEdit) {
      onEdit(shown.clientEntryId ?? shown.id);
    } else {
      setStep("delete");
    }
  }

  if (step === "delete") {
    return (
      <ConfirmDialog
        visible={entry !== null}
        tone="destructive"
        title={review.delete.title}
        body={isText ? review.delete.bodyText : review.delete.bodyAudio}
        confirmLabel={review.delete.confirm}
        cancelLabel={review.delete.cancel}
        loading={busy}
        onConfirm={confirm}
        onCancel={onClose}
      />
    );
  }

  return (
    <ConfirmDialog
      visible={entry !== null}
      title={review.title}
      body={copy.problems.reason(shown.pending?.lastErrorCode ?? null)}
      confirmLabel={canEdit ? review.edit : review.deleteAction}
      cancelLabel={review.close}
      onConfirm={confirm}
      onCancel={onClose}
    >
      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={review.deleteAction}
          className="mt-3 min-h-11 items-center justify-center px-4"
          onPress={() => setStep("delete")}
        >
          <Text className="btn-text__label btn-text__label--rosewood">{review.deleteAction}</Text>
        </Pressable>
      ) : null}
    </ConfirmDialog>
  );
}
