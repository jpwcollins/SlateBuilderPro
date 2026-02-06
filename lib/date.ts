export function getBlockMinutes(date: Date): number {
  const day = date.getDay(); // 0 Sun, 1 Mon, 2 Tue
  const isTuesday = day === 2;
  if (isTuesday) {
    const weekOfMonth = getWeekOfMonth(date);
    if (weekOfMonth === 2 || weekOfMonth === 4) {
      return 420; // 09:00-16:00
    }
  }
  return 480; // 08:00-16:00
}

export function getBlockStartMinutes(date: Date): number {
  const day = date.getDay();
  const isTuesday = day === 2;
  if (isTuesday) {
    const weekOfMonth = getWeekOfMonth(date);
    if (weekOfMonth === 2 || weekOfMonth === 4) {
      return 9 * 60;
    }
  }
  return 8 * 60;
}

export function formatMinutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${hh}${mm}`;
}

function getWeekOfMonth(date: Date): number {
  const dayOfMonth = date.getDate();
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const offset = (firstDay + 6) % 7; // align Monday=0
  return Math.floor((dayOfMonth + offset - 1) / 7) + 1;
}
