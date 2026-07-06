import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Moon, Printer, Search, Sun } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
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
const hours: Record<string, string> = { M: '06:00–14:00', A: '14:00–22:00', N: '22:00–06:00', MID: '09:00–17:00', OFF: 'AD', H8: 'H8' };
const shiftLabels: Record<string, string> = { M: 'Morning', A: 'Afternoon', N: 'Night', MID: 'Mid', OFF: 'Off', H8: 'H8' };

type ScheduleJson = Omit<RosterData, 'dateColumns' | 'fileName'> & {
  dateColumns: { index: number; date: string; isoDate: string }[];
  fileName?: string;
};
type DailyRoster = { morning: string[]; afternoon: string[]; night: string[]; mid: string[]; off: string[] };
type TeammateGroup = { title: string; employees: { name: string; suffix?: string }[] };

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
function sortedEmployees(names: string[], selectedEmployee: string, suffix?: string) {
  return names
    .filter((name) => name !== selectedEmployee)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, suffix }));
}
function parseIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function hydrateRoster(data: ScheduleJson): RosterData {
  return {
    ...data,
    fileName: data.fileName ?? 'schedule.json',
    dateColumns: data.dateColumns.map((column) => ({ ...column, date: parseIsoDate(column.isoDate) })),
  };
}
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
function eventsForEmployee(roster: RosterData, employee: string): ShiftEvent[] {
  const shifts = roster.rows[employee] ?? {};
  return roster.dateColumns
    .filter(({ isoDate }) => shifts[isoDate])
    .map(({ date, isoDate }) => ({ id: `${employee}-${isoDate}`, date, isoDate, shift: shifts[isoDate] }));
}

function teammateGroupsForShift(shift: string, daily: DailyRoster | undefined, selectedEmployee: string): TeammateGroup[] {
  if (!daily) return [];
  const code = shiftKey(shift);

  if (code === 'M') return [{ title: 'Morning', employees: [...sortedEmployees(daily.morning, selectedEmployee), ...sortedEmployees(daily.mid, selectedEmployee, 'MID')].sort((a, b) => a.name.localeCompare(b.name)) }];
  if (code === 'A') return [{ title: 'Afternoon', employees: [...sortedEmployees(daily.afternoon, selectedEmployee), ...sortedEmployees(daily.mid, selectedEmployee, 'MID')].sort((a, b) => a.name.localeCompare(b.name)) }];
  if (code === 'N') return [{ title: 'Night', employees: sortedEmployees(daily.night, selectedEmployee) }];
  if (code === 'MID') return [
    { title: 'Morning', employees: sortedEmployees(daily.morning, selectedEmployee) },
    { title: 'Afternoon', employees: sortedEmployees(daily.afternoon, selectedEmployee) },
    { title: 'Mid', employees: sortedEmployees(daily.mid, selectedEmployee, 'MID') },
  ];
  if (code === 'OFF') return [{ title: 'Off', employees: sortedEmployees(daily.off, selectedEmployee) }];
  return [];
}

function EmployeeList({ employees }: { employees: { name: string; suffix?: string }[] }) {
  return <div className="space-y-1.5">
    {employees.map(({ name, suffix }) => <div key={`${name}-${suffix ?? ''}`} className="flex items-center gap-3 rounded-xl bg-white p-2 shadow-sm dark:bg-zinc-800">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-black text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100">{initials(name)}</span>
      <span className="text-sm font-semibold">{name}{suffix ? ` (${suffix})` : ''}</span>
    </div>)}
  </div>;
}
function TeammateSection({ groups }: { groups: TeammateGroup[] }) {
  const hasEmployees = groups.some((group) => group.employees.length > 0);
  return <section className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-950/70">
    <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Employees on this shift</h3>
    {hasEmployees ? <div className="mt-3 space-y-3">
      {groups.map((group) => group.employees.length > 0 && <div key={group.title}>
        <h4 className="mb-2 text-sm font-black">{group.title}</h4>
        <EmployeeList employees={group.employees}/>
      </div>)}
    </div> : <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No other employees are working this shift.</p>}
  </section>;
}

export default function App() {
  const [dark, setDark] = useState(true);
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedEvent, setSelectedEvent] = useState<ShiftEvent | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    fetch(`${import.meta.env.BASE_URL}schedule.json`)
      .then((response) => {
        if (!response.ok) throw new Error('Schedule file not found. Run npm run import -- path/to/roster.xlsx.');
        return response.json() as Promise<ScheduleJson>;
      })
      .then((data) => {
        if (!mounted) return;
        const parsed = hydrateRoster(data);
        setRoster(parsed);
        setCurrentMonth(parsed.month);
        setCurrentYear(parsed.year);
        setSelectedEmployee(parsed.employees[0] ?? '');
      })
      .catch((err) => mounted && setError(err instanceof Error ? err.message : 'Unable to load schedule.'));
    return () => { mounted = false; };
  }, []);

  const events = useMemo(() => (roster && selectedEmployee ? eventsForEmployee(roster, selectedEmployee) : []), [roster, selectedEmployee]);
  const eventMap = useMemo(() => Object.fromEntries(events.map((event) => [event.isoDate, event])), [events]);
  const rosterIndex = useMemo(() => buildRosterIndex(roster), [roster]);
  const selectedDailyRoster = selectedEvent ? rosterIndex[selectedEvent.isoDate] : undefined;
  const selectedTeammateGroups = useMemo(() => selectedEvent ? teammateGroupsForShift(selectedEvent.shift, selectedDailyRoster, selectedEmployee) : [], [selectedDailyRoster, selectedEmployee, selectedEvent]);
  const filteredEmployees = useMemo(() => roster?.employees.filter((name) => name.toLowerCase().includes(query.toLowerCase())) ?? [], [query, roster]);
  const calendarDays = useMemo(() => monthDays(currentMonth, currentYear), [currentMonth, currentYear]);
  const title = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(currentYear, currentMonth));
  const todayIso = iso(new Date());

  async function exportPdf() {
    if (!printRef.current) return;
    const canvas = await html2canvas(printRef.current, { backgroundColor: dark ? '#111113' : '#ffffff', scale: 2 });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save('work-schedule.pdf');
  }

  return <main className={dark ? 'dark' : ''}><div className="min-h-screen bg-zinc-100 text-zinc-950 transition dark:bg-black dark:text-white">
    <section className="mx-auto max-w-3xl px-3 py-4 sm:py-6">
      <div className="mb-3 flex items-center justify-between"><div><p className="text-xs text-green-500">Work Schedule</p><h1 className="text-3xl font-black tracking-tight">{roster ? title : 'Work Schedule'}</h1><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{roster ? selectedEmployee : 'Loading schedule...'}</p></div><button onClick={() => setDark(!dark)} className="rounded-full bg-white p-2.5 shadow dark:bg-zinc-900">{dark ? <Sun/> : <Moon/>}</button></div>
      {error && <div className="mb-3 rounded-2xl bg-red-100 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</div>}
      {!roster && !error && <div className="rounded-2xl bg-white p-4 text-center font-semibold shadow dark:bg-zinc-900">Loading schedule...</div>}
      {roster && <><div className="mb-3 rounded-2xl bg-white p-3 shadow dark:bg-zinc-900"><label className="text-xs font-semibold text-zinc-500">Choose Employee</label><div className="mt-2 flex items-center gap-2 rounded-xl bg-zinc-100 px-3 dark:bg-zinc-800"><Search className="size-4 text-zinc-400"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search employee names" className="w-full bg-transparent py-2 text-sm outline-none"/></div><select value={selectedEmployee} onChange={(e) => setSelectedEmployee(e.target.value)} className="mt-2 w-full rounded-xl bg-zinc-100 p-2 text-sm font-semibold outline-none dark:bg-zinc-800">{filteredEmployees.map((name) => <option key={name}>{name}</option>)}</select></div>
      <div className="mb-3 flex gap-2"><button onClick={() => { const d = new Date(currentYear, currentMonth - 1); setCurrentMonth(d.getMonth()); setCurrentYear(d.getFullYear()); }} className="rounded-full bg-white p-2.5 shadow dark:bg-zinc-900"><ChevronLeft className="size-5"/></button><button onClick={() => { const d = new Date(currentYear, currentMonth + 1); setCurrentMonth(d.getMonth()); setCurrentYear(d.getFullYear()); }} className="rounded-full bg-white p-2.5 shadow dark:bg-zinc-900"><ChevronRight className="size-5"/></button><button onClick={() => window.print()} className="ml-auto rounded-full bg-white p-2.5 shadow dark:bg-zinc-900"><Printer className="size-5"/></button><button onClick={exportPdf} className="rounded-full bg-white p-2.5 shadow dark:bg-zinc-900"><Download className="size-5"/></button></div>
      <div ref={printRef} className="overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"><div className="grid grid-cols-7 bg-zinc-50 text-center text-xs font-bold text-zinc-500 dark:bg-zinc-800">{weekdays.map((day, i) => <div className="py-2" key={`${day}-${i}`}>{day}</div>)}</div><div className="grid grid-cols-7">{calendarDays.map((day) => { const dayIso = iso(day); const event = eventMap[dayIso]; const colors = event ? colorFor(event.shift) : fallbackColor; return <button key={dayIso} onClick={() => event && setSelectedEvent(event)} className={`flex min-h-[4.35rem] flex-col border-t border-zinc-200 px-1 py-1 text-left transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800 ${day.getMonth() !== currentMonth ? 'opacity-25' : ''}`}><span className={`mx-auto flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${dayIso === todayIso ? 'bg-white text-black shadow' : ''}`}>{day.getDate()}</span><span className="mt-1 block min-h-[1.55rem] w-full">{event && <span className={`block truncate rounded-lg border px-1 py-1 text-center text-[0.68rem] font-bold leading-none ${colors.bg} ${colors.text} ${colors.border}`}>{shiftLabel(event.shift)}</span>}</span></button>; })}</div></div></>}
    </section>
    {selectedEvent && <div className="fixed inset-0 z-10 flex items-end bg-black/40" onClick={() => setSelectedEvent(null)}><div onClick={(e) => e.stopPropagation()} className="max-h-[86vh] w-full overflow-y-auto rounded-t-[1.5rem] bg-white p-5 shadow-2xl animate-in slide-in-from-bottom dark:bg-zinc-900"><div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-300"/><p className="text-sm text-zinc-500">{selectedEvent.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p><div className={`my-4 rounded-2xl border p-6 text-center ${colorFor(selectedEvent.shift).bg} ${colorFor(selectedEvent.shift).text} ${colorFor(selectedEvent.shift).border}`}><div className="text-4xl font-black tracking-tight">{shiftLabel(selectedEvent.shift)}</div><div className="mt-2 text-lg font-bold">{shiftHours(selectedEvent.shift)}</div></div><div className="mb-4 rounded-2xl bg-zinc-50 p-3 text-sm dark:bg-zinc-950/70"><p><b>Shift:</b> {shiftLabel(selectedEvent.shift)}</p><p><b>Working hours:</b> {shiftHours(selectedEvent.shift)}</p></div><TeammateSection groups={selectedTeammateGroups}/><button onClick={() => setSelectedEvent(null)} className="mt-5 w-full rounded-2xl bg-zinc-950 py-3 font-bold text-white dark:bg-white dark:text-black">Close</button></div></div>}
  </div></main>;
}
