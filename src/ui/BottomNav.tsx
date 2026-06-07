import { Icon } from "./Icon";

export type NavDestination = "tokens" | "activity" | "sites" | "settings";

const DESTINATIONS: Array<{ id: NavDestination; label: string; icon: string }> = [
  { id: "tokens", label: "Tokens", icon: "coins" },
  { id: "activity", label: "Activity", icon: "history" },
  { id: "sites", label: "Sites", icon: "globe" },
  { id: "settings", label: "Settings", icon: "settings" }
];

export function BottomNav({ value, onChange, badge }: {
  value: NavDestination;
  onChange: (value: NavDestination) => void;
  badge?: Partial<Record<NavDestination, number>>;
}) {
  return (
    <nav className="nav bottom-nav" aria-label="Primary">
      {DESTINATIONS.map(({ id, label, icon }) => {
        const count = badge?.[id] ?? 0;
        return (
          <button
            key={id}
            type="button"
            className={`nav-item bottom-nav-item${value === id ? " active" : ""}`}
            aria-current={value === id ? "page" : undefined}
            onClick={() => onChange(id)}
          >
            <span className="nav-ico bottom-nav-icon">
              <Icon name={icon} size={20} />
              {count > 0 && <span className="nav-badge bottom-nav-badge">{count}</span>}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
