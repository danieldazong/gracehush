// Local calendar arithmetic, not 24-hour blocks, so a daylight-saving change cannot move an entry to
// another day. Avoid clock times between 1 and 3 AM, which some days skip.
export function daysAgo(days: number, hour: number, minute: number, now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour, minute);
}

export function minutesAgo(minutes: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - minutes * 60000);
}
