// Date utilities

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function isSameDay(date1: Date, date2: Date): boolean {
  return date1.toDateString() === date2.toDateString();
}

export function daysBetween(date1: Date, date2: Date): number {
  const d1 = startOfDay(date1).getTime();
  const d2 = startOfDay(date2).getTime();
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function getMonthYearTR(date: Date): string {
  const months = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function getDateTR(date: Date): string {
  const months = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function getDayNameTR(date: Date): string {
  const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  return days[date.getDay()];
}

export function parseDateTR(str: string): Date | null {
  // Parse "15 Ocak 2024" format
  const months: Record<string, number> = {
    ocak: 0, şubat: 1, mart: 2, nisan: 3, mayıs: 4, haziran: 5,
    temmuz: 6, ağustos: 7, eylül: 8, ekim: 9, kasım: 10, aralık: 11
  };
  const match = str.match(/(\d+)\s+(\w+)\s+(\d{4})/i);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = months[match[2].toLowerCase()];
  const year = parseInt(match[3], 10);
  if (month === undefined) return null;
  return new Date(year, month, day);
}

export function dateBackList(date: Date | string, count = 8): string[] {
  const base = new Date(typeof date === 'string' ? date : date.toISOString().split('T')[0] + 'T12:00:00');
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    result.push(d.toISOString().split('T')[0]);
  }
  return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

export * from './duration';