import * as XLSX from 'xlsx';
import type { RosterData, ShiftEvent } from './types';

const excelEpoch = new Date(Date.UTC(1899, 11, 30));
const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function excelSerialToDate(value: number) {
  const date = new Date(excelEpoch);
  date.setUTCDate(date.getUTCDate() + value);
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseDateCell(value: unknown, fallbackYear: number): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && value > 1 && value < 60000) return excelSerialToDate(value);
  const text = String(value ?? '').trim().replace(/\./g, '-');
  if (!text) return null;
  const native = new Date(text);
  if (!Number.isNaN(native.getTime()) && /\d/.test(text)) return native;
  const dayMonth = text.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,}|\d{1,2})(?:[-/\s](\d{2,4}))?$/);
  if (!dayMonth) return null;
  const day = Number(dayMonth[1]);
  const monthToken = dayMonth[2].toLowerCase();
  const month = /^\d+$/.test(monthToken) ? Number(monthToken) - 1 : monthNames.findIndex((name) => monthToken.startsWith(name));
  const year = dayMonth[3] ? Number(dayMonth[3].length === 2 ? `20${dayMonth[3]}` : dayMonth[3]) : fallbackYear;
  if (month < 0 || day < 1 || day > 31) return null;
  return new Date(year, month, day);
}

function likelyName(value: unknown) {
  const text = String(value ?? '').trim();
  return /^[\p{L} .'-]{3,}$/u.test(text) && !/employee|equipment|morning|night|after|shift/i.test(text);
}

export async function parseRoster(file: File): Promise<RosterData> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false });
  const currentYear = new Date().getFullYear();

  let headerRow = -1;
  let dateColumns: RosterData['dateColumns'] = [];
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    const columns = rows[rowIndex] ?? [];
    const detected = columns
      .map((cell, index) => ({ index, date: parseDateCell(cell, currentYear) }))
      .filter((item): item is { index: number; date: Date } => Boolean(item.date));
    if (detected.length >= 3) {
      headerRow = rowIndex;
      dateColumns = detected.map(({ index, date }) => ({ index, date, isoDate: toIso(date) }));
      break;
    }
  }
  if (headerRow < 0 || dateColumns.length === 0) throw new Error('Could not find the date header row. Make sure the top row contains dates.');

  const nameColumn = rows[headerRow]?.findIndex((cell) => /employee|name/i.test(String(cell ?? '')));
  const employeeCol = nameColumn && nameColumn >= 0 ? nameColumn : 0;
  const employees: string[] = [];
  const parsedRows: RosterData['rows'] = {};

  for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const employee = String(row[employeeCol] ?? '').trim();
    if (!likelyName(employee)) continue;
    const shifts: Record<string, string> = {};
    dateColumns.forEach(({ index, isoDate }) => {
      const value = String(row[index] ?? '').trim();
      if (value) shifts[isoDate] = value;
    });
    if (Object.keys(shifts).length) {
      employees.push(employee);
      parsedRows[employee] = shifts;
    }
  }
  if (!employees.length) throw new Error('No employee rows were found below the date header.');

  const monthCounts = dateColumns.reduce<Record<number, number>>((acc, column) => {
    acc[column.date.getMonth()] = (acc[column.date.getMonth()] ?? 0) + 1;
    return acc;
  }, {});
  const month = Number(Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0][0]);
  const year = dateColumns.find((column) => column.date.getMonth() === month)?.date.getFullYear() ?? currentYear;
  return { month, year, employees, rows: parsedRows, dateColumns, fileName: file.name };
}

export function eventsForEmployee(roster: RosterData, employee: string): ShiftEvent[] {
  const shifts = roster.rows[employee] ?? {};
  return roster.dateColumns
    .filter(({ isoDate }) => shifts[isoDate])
    .map(({ date, isoDate }) => ({ id: `${employee}-${isoDate}`, date, isoDate, shift: shifts[isoDate] }));
}
