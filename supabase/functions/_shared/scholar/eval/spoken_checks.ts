// Two checks of the spoken evaluation (step 39, run_scholar_eval.ts --spoken). In a live talk nothing is shown under an answer and
// the person spoke, so no answer may point "under this message" or speak of what the person wrote or typed. They are their own
// file so that a test can hold them: a check that is too wide fails a true sentence ("Paul wrote this letter"), and one that is
// too narrow passes a wrong one.

// "the line under this message", "the link under this message": true of a typed answer, and of nothing in a talk.
export function pointsUnderMessage(text: string): boolean {
  return /under (?:this|my|your) message/i.test(text);
}

// The person as the one who wrote: "what you wrote", "you've written", "the words you typed", "your written words". A sentence
// about who wrote a book of the Bible, or "it is written", is not that.
const THEY_WROTE =
  /\byou(?:['’](?:ve|d)| have| had)?(?: (?:just|also|first|once|already))? (?:wrote|written|typed)\b|\byour (?:written|typed) (?:words|message|note)\b/i;

export function saysTheyWrote(text: string): boolean {
  return THEY_WROTE.test(text);
}
