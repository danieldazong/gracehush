import { create } from "zustand";

// A prayer change the server refused for good (step 29): the sync engine dropped it and read the entry again, and Prayers and
// Reflection say "We couldn't save that change." inline until the next refresh or tab change, never on a timer. Not persisted,
// and the engine clears it when it stops (sign-out), so it never reaches another account. It holds which entry, and nothing the
// person wrote.
interface NoticeState {
  // The entry whose change was dropped: Reflection shows the line only for its own entry, Prayers for any.
  prayerChangeFailed: string | null;
  pushPrayerChangeFailed: (entryId: string) => void;
  clearPrayerChangeFailed: () => void;
}

export const useNoticeStore = create<NoticeState>()((set) => ({
  prayerChangeFailed: null,
  pushPrayerChangeFailed: (entryId) => set({ prayerChangeFailed: entryId }),
  clearPrayerChangeFailed: () => set({ prayerChangeFailed: null }),
}));
