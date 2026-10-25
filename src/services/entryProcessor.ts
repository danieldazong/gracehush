import { processMock } from "@/data/journalRepository";
import type { OutboxItem, ProcessingStage, ProcessOutcome } from "@/types";

// The one place the sync engine hands an outbox item to be prepared (step 24). It answers with the finished entry, or with
// why not (a ProcessEntryErrorCode, or NETWORK when no answer came). It never throws and it reports its progress through
// `onStage`, which the New Entry overlay shows.
//
// TEMP(25): the real processor uploads the recording (uploadRawRecording), calls process-entry and maps its answer. Keep
// this interface. While `processorIsMock` is true the engine does not write the answer to the read cache: the mock's
// entries live in the in-memory mock database, and a persisted copy of them would outlive the mock.
export const processorIsMock = true;

export function processItem(
  item: OutboxItem,
  onStage: (stage: ProcessingStage) => void,
): Promise<ProcessOutcome> {
  return processMock(item, onStage);
}
