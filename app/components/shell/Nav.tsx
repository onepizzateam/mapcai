// Nav — left icon rail (agents.md §3 shell). Static chrome for the demo; the
// dashboard is the only live view. Icons are inline SVG (no icon library — the
// spec discourages libraries for problems we can solve without them).

const ITEMS = [
  { id: 'fleet', label: 'Fleet', active: true, path: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { id: 'alerts', label: 'Alerts', active: false, path: 'M12 3l9 16H3zM12 10v4M12 17h.01' },
  { id: 'reports', label: 'Reports', active: false, path: 'M6 3h9l4 4v14H6zM14 3v5h5' },
  { id: 'settings', label: 'Settings', active: false, path: 'M12 8a4 4 0 100 8 4 4 0 000-8z' },
];

export function Nav() {
  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-14 flex-col items-center gap-2 border-r border-border bg-surface py-3"
    >
      <div className="mb-2 grid h-9 w-9 place-items-center rounded-lg bg-accent text-sm font-bold text-white">
        C
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={item.label}
          aria-current={item.active ? 'page' : undefined}
          className={[
            'grid h-10 w-10 place-items-center rounded-lg transition-colors',
            item.active
              ? 'bg-bg text-accent'
              : 'text-text-muted hover:bg-bg hover:text-text-primary',
          ].join(' ')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d={item.path} />
          </svg>
        </button>
      ))}
    </nav>
  );
}
