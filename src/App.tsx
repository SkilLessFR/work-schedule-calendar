import { useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Moon, Printer, Search, Sun, Upload } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { eventsForEmployee, parseRoster } from './parser';
import type { RosterData, ShiftColor, ShiftEvent } from './types';

const shiftColors: Record<string, ShiftColor> = {
  MID: { bg: 'bg-blue-200 dark:bg-blue-500/30', text: 'text-blue-950 dark:text-blue-100', border: 'border-blue-300/70' },
  A: { bg: 'bg-orange-200 dark:bg-orange-500/30', text: 'text-orange-950 dark:text-orange-100', border: 'border-orange-300/70' },
  M: { bg: 'bg-emerald-200 dark:bg-emerald-500/30', text: 'text-emerald-950 dark:text-emerald-100', border: 'border-emerald-300/70' },
  N: { bg: 'bg-purple-200 dark:bg-purple-500/30', text: 'text-purple-950 dark:text-purple-100', border: 'border-purple-300/70' },
  OFF: { bg: 'bg-green-200 dark:bg-green-500/30', text: 'text-green-950 dark:text-green-100', border: 'border-green-300/70' },
  H8: { bg: 'bg-lime-200 dark:bg-lime-500/30', text: 'text-lime-950 dark:text-lime-100', border: 'border-lime-300/70' },
};
const fallbackColor = { bg: 'bg-slate-300 dark:bg-slate-600', text: 'text-slate-950 dark:text-white', border: 'border-slate-400/70' };
const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const hours: Record<string, string> = { MID: '09:00 - 17:00', M: '06:00 - 14:00', A: '14:00 - 22:00', N: '22:00 - 06:00', H8: 'Holiday', OFF: 'Off Day' };
const shiftLabels: Record<string, string> = { M: 'Morning', A: 'Afternoon', N: 'Night', MID: 'MID', OFF: 'Off Today', H8: 'Holiday' };

type DailyRoster = { morning: string[]; afternoon: string[]; night: string[]; mid: string[]; off: string[] };
type WorkingGroup = { title: string; employees: { name: string; suffix?: string }[] };

function monthDays(month: number, year: number) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}
function iso(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function colorFor(shift: string) { return shiftColors[shift.toUpperCase()] ?? fallbackColor; }
function shiftKey(shift: string) { return shift.trim().toUpperCase(); }
function shiftHours(shift: string) { return hours[shiftKey(shift)] ?? 'Not provided'; }
function shiftLabel(shift: string) { return shiftLabels[shiftKey(shift)] ?? shift; }
function emptyDailyRoster(): DailyRoster { return { morning: [], afternoon: [], night: [], mid: [], off: [] }; }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }

function buildRosterIndex(roster: RosterData | null) {
  if (!roster) return {} as Record<string, DailyRoster>;

  return roster.dateColumns.reduce<Record<string, DailyRoster>>((index, { isoDate }) => {
    const daily = emptyDailyRoster();

    roster.employees.forEach((employee) => {
      const code = shiftKey(roster.rows[employee]?.[isoDate] ?? '');
      if (code === 'M') daily.morning.push(employee);
      if (code === 'A') daily.afternoon.push(employee);
      if (code === 'N') daily.night.push(employee);
      if (code === 'MID') daily.mid.push(employee);
      if (code === 'OFF') daily.off.push(employee);
    });

    index[isoDate] = daily;
    return index;
  }, {});
}

function removeEmployee(names: string[], selectedEmployee: string) {
  return names.filter((name) => name !== selectedEmployee);
}

function groupForShift(shift: string, daily: DailyRoster | undefined, selectedEmployee: string): WorkingGroup | null {
  if (!daily) return null;
  const code = shiftKey(shift);
  if (code === 'OFF') return null;
  if (code === 'M') return { title: 'Morning', employees: [...removeEmployee(daily.morning, selectedEmployee).map((name) => ({ name })), ...removeEmployee(daily.mid, selectedEmployee).map((name) => ({ name, suffix: 'MID' }))] };
  if (code === 'A') return { title: 'Afternoon', employees: [...removeEmployee(daily.afternoon, selectedEmployee).map((name) => ({ name })), ...removeEmployee(daily.mid, selectedEmployee).map((name) => ({ name, suffix: 'MID' }))] };
  if (code === 'N') return { title: 'Night', employees: removeEmployee(daily.night, selectedEmployee).map((name) => ({ name })) };
  if (code === 'MID') return { title: 'MID', employees: removeEmployee(daily.mid, selectedEmployee).map((name) => ({ name })) };
  return { title: shiftLabel(shift), employees: [] };
}

function EmployeeList({ employees }: { employees: { name: string; suffix?: string }[] }) {
  return <div className="space-y-2">
    {employees.map(({ name, suffix }) => <div key={`${name}-${suffix ?? ''}`} className="flex items-center gap-3 rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-800/80">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-zinc-700 shadow-sm dark:bg-zinc-700 dark:text-zinc-100">{initials(name)}</span>
      <span className="font-semibold">{name}{suffix ? ` (${suffix})` : ''}</span>
    </div>)}
  </div>;
}

function WorkingSection({ group }: { group: WorkingGroup | null }) {
  return <section className="rounded-[1.5rem] bg-zinc-50 p-4 dark:bg-zinc-950/70">
    <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-500">Also Working</h3>
    {group && group.employees.length > 0 ? <div className="mt-4">
      <h4 className="mb-3 text-lg font-black">{group.title}</h4>
      <EmployeeList employees={group.employees}/>
    </div> : <p className="mt-3 text-zinc-500 dark:text-zinc-400">No other employees are working this shift.</p>}
  </section>;
}

function OffTodaySection({ daily, selectedEmployee }: { daily?: DailyRoster; selectedEmployee: string }) {
  const offEmployees = daily ? removeEmployee(daily.off, selectedEmployee).map((name) => ({ name })) : [];
  return <section className="rounded-[1.5rem] bg-zinc-50 p-4 dark:bg-zinc-950/70">
    <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-500">Who's Off Today</h3>
    {offEmployees.length > 0 ? <div className="mt-4">
      <h4 className="mb-3 text-lg font-black">Off Today</h4>
      <EmployeeList employees={offEmployees}/>
    </div> : <p className="mt-3 text-zinc-500 dark:text-zinc-400">No coworkers are marked off today.</p>}
  </section>;
}

export default function App() {
  const [dark, setDark] = useState(true);
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState(localStorage.getItem('work-schedule-employee') ?? '');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedEvent, setSelectedEvent] = useState<ShiftEvent | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const events = useMemo(() => (roster && selectedEmployee ? eventsForEmployee(roster, selectedEmployee) : []), [roster, selectedEmployee]);
  const eventMap = useMemo(() => Object.fromEntries(events.map((event) => [event.isoDate, event])), [events]);
  const rosterIndex = useMemo(() => buildRosterIndex(roster), [roster]);
  const selectedDailyRoster = selectedEvent ? rosterIndex[selectedEvent.isoDate] : undefined;
  const selectedWorkingGroup = useMemo(() => selectedEvent ? groupForShift(selectedEvent.shift, selectedDailyRoster, selectedEmployee) : null, [selectedDailyRoster, selectedEmployee, selectedEvent]);
  const filteredEmployees = useMemo(() => roster?.employees.filter((name) => name.toLowerCase().includes(query.toLowerCase())) ?? [], [query, roster]);
  const calendarDays = useMemo(() => monthDays(currentMonth, currentYear), [currentMonth, currentYear]);
  const title = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(currentYear, currentMonth));
  const todayIso = iso(new Date());

  async function handleFile(file?: File) {
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) { setError('Please upload a .xlsx or .xls Excel file.'); return; }
    try {
      setError('');
      const parsed = await parseRoster(file);
      setRoster(parsed); setCurrentMonth(parsed.month); setCurrentYear(parsed.year);
      const remembered = parsed.employees.includes(selectedEmployee) ? selectedEmployee : parsed.employees[0];
      setSelectedEmployee(remembered); localStorage.setItem('work-schedule-employee', remembered);
    } catch (err) { setError(err instanceof Error ? err.message : 'We could not read this spreadsheet.'); }
  }
  async function exportPdf() {
    if (!printRef.current) return;
    const canvas = await html2canvas(printRef.current, { backgroundColor: dark ? '#111113' : '#ffffff', scale: 2 });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save('work-schedule.pdf');
  }

  return <main className={dark ? 'dark' : ''}><div className="min-h-screen bg-zinc-100 text-zinc-950 transition dark:bg-black dark:text-white">
    <section className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center justify-between"><div><p className="text-sm text-green-500">Work Schedule</p><h1 className="text-5xl font-black tracking-tight">{roster ? title : 'Work Schedule'}</h1><p className="mt-2 text-zinc-500 dark:text-zinc-400">{roster ? `${selectedEmployee} · ${roster.fileName}` : 'Upload your monthly roster.'}</p></div><button onClick={() => setDark(!dark)} className="rounded-full bg-white p-3 shadow dark:bg-zinc-900">{dark ? <Sun/> : <Moon/>}</button></div>
      {!roster && <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void handleFile(e.dataTransfer.files[0]); }} className="group flex min-h-72 cursor-pointer flex-col items-center justify-center rounded-[2rem] border-2 border-dashed border-zinc-300 bg-white p-8 text-center shadow-xl transition hover:scale-[1.01] dark:border-zinc-700 dark:bg-zinc-900"><Upload className="mb-4 size-12 text-green-500"/><h2 className="text-2xl font-bold">Drop your Excel roster here</h2><p className="my-3 text-zinc-500">or tap to Upload Excel (.xlsx, .xls)</p><input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])}/><span className="rounded-full bg-green-500 px-6 py-3 font-bold text-white shadow-lg">Upload Excel</span></label>}
      {error && <div className="mt-4 rounded-2xl bg-red-100 p-4 text-red-700 dark:bg-red-950 dark:text-red-200">{error}</div>}
      {roster && <><div className="mb-5 rounded-[2rem] bg-white p-4 shadow-lg dark:bg-zinc-900"><label className="text-sm font-semibold text-zinc-500">Choose Employee</label><div className="mt-3 flex items-center gap-2 rounded-2xl bg-zinc-100 px-3 dark:bg-zinc-800"><Search className="size-5 text-zinc-400"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search employee names" className="w-full bg-transparent py-3 outline-none"/></div><select value={selectedEmployee} onChange={(e) => { setSelectedEmployee(e.target.value); localStorage.setItem('work-schedule-employee', e.target.value); }} className="mt-3 w-full rounded-2xl bg-zinc-100 p-3 font-semibold outline-none dark:bg-zinc-800">{filteredEmployees.map((name) => <option key={name}>{name}</option>)}</select></div>
      <div className="mb-4 flex gap-2"><button onClick={() => { const d = new Date(currentYear, currentMonth - 1); setCurrentMonth(d.getMonth()); setCurrentYear(d.getFullYear()); }} className="rounded-full bg-white p-3 shadow dark:bg-zinc-900"><ChevronLeft/></button><button onClick={() => { const d = new Date(currentYear, currentMonth + 1); setCurrentMonth(d.getMonth()); setCurrentYear(d.getFullYear()); }} className="rounded-full bg-white p-3 shadow dark:bg-zinc-900"><ChevronRight/></button><button onClick={() => window.print()} className="ml-auto rounded-full bg-white p-3 shadow dark:bg-zinc-900"><Printer/></button><button onClick={exportPdf} className="rounded-full bg-white p-3 shadow dark:bg-zinc-900"><Download/></button></div>
      <div ref={printRef} className="overflow-hidden rounded-[2rem] bg-white shadow-2xl dark:bg-zinc-900"><div className="grid grid-cols-7 bg-zinc-50 text-center text-sm font-bold text-zinc-500 dark:bg-zinc-800">{weekdays.map((day, i) => <div className="py-3" key={`${day}-${i}`}>{day}</div>)}</div><div className="grid grid-cols-7">{calendarDays.map((day) => { const dayIso = iso(day); const event = eventMap[dayIso]; const colors = event ? colorFor(event.shift) : fallbackColor; return <button key={dayIso} onClick={() => event && setSelectedEvent(event)} className={`flex min-h-24 flex-col border-t border-zinc-200 p-1 text-left transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800 ${day.getMonth() !== currentMonth ? 'opacity-25' : ''}`}><span className={`mx-auto flex size-8 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${dayIso === todayIso ? 'bg-white text-black shadow' : ''}`}>{day.getDate()}</span><span className="mt-2 block min-h-[3.25rem] w-full">{event && <span className={`block rounded-md border px-1 py-1 text-center text-sm font-bold ${colors.bg} ${colors.text} ${colors.border}`}>{event.shift}<br/><small>{shiftHours(event.shift)}</small></span>}</span></button>; })}</div></div></>}
    </section>
    {selectedEvent && <div className="fixed inset-0 z-10 flex items-end bg-black/40" onClick={() => setSelectedEvent(null)}><div onClick={(e) => e.stopPropagation()} className="max-h-[88vh] w-full overflow-y-auto rounded-t-[2rem] bg-white p-6 shadow-2xl animate-in slide-in-from-bottom dark:bg-zinc-900"><div className="mx-auto mb-5 h-1 w-12 rounded-full bg-zinc-300"/><p className="text-zinc-500">{selectedEvent.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p><div className={`my-5 rounded-[2rem] border p-8 text-center ${colorFor(selectedEvent.shift).bg} ${colorFor(selectedEvent.shift).text} ${colorFor(selectedEvent.shift).border}`}><div className="text-6xl font-black tracking-tight">{selectedEvent.shift}</div><div className="mt-3 text-xl font-bold">{shiftHours(selectedEvent.shift)}</div></div><div className="mb-5 rounded-[1.5rem] bg-zinc-50 p-4 dark:bg-zinc-950/70"><p><b>My shift:</b> {shiftLabel(selectedEvent.shift)}</p><p><b>Shift hours:</b> {shiftHours(selectedEvent.shift)}</p></div><div className="space-y-4"><WorkingSection group={selectedWorkingGroup}/><OffTodaySection daily={selectedDailyRoster} selectedEmployee={selectedEmployee}/></div><button onClick={() => setSelectedEvent(null)} className="mt-6 w-full rounded-2xl bg-zinc-950 py-4 font-bold text-white dark:bg-white dark:text-black">Close</button></div></div>}
  </div></main>;
}
