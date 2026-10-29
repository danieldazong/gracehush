import type { SymbolViewProps } from "expo-symbols";
import { Text } from "react-native";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { copy } from "@/constants/copy";
import { useAnnounce } from "@/hooks/useAnnounce";
import type { DeleteReflectionDialogState } from "@/hooks/useDeleteReflection";

const text = copy.deleteReflection;

const trash = { android: "delete", ios: "trash" } satisfies SymbolViewProps["name"];

// "Delete this reflection forever?" (step 29b), the one dialog for Prayers and Reflection. The confirm button is crisis red
// (ConfirmDialog's destructive tone): this and the Delete row of the prayer menu are the only red on those screens. A failure
// stays inside the dialog as a calm line, and the confirm button tries again.
export function DeleteReflectionDialog({
  visible,
  answered,
  running,
  failed,
  onConfirm,
  onCancel,
}: DeleteReflectionDialogState) {
  useAnnounce(failed ? text.failed : null);

  return (
    <ConfirmDialog
      visible={visible}
      tone="destructive"
      icon={trash}
      title={text.title}
      body={answered ? text.bodyAnswered : text.body}
      confirmLabel={text.confirm}
      cancelLabel={text.cancel}
      loading={running}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {failed ? (
        <Text accessibilityLiveRegion="polite" className="mt-3 text-center text-body-sm text-rosewood">
          {text.failed}
        </Text>
      ) : null}
    </ConfirmDialog>
  );
}
