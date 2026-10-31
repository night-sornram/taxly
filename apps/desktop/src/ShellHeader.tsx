import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Brand } from "./components";
import AreaSwitcher from "./AreaSwitcher";

type Tab<V extends string> = { id: V; label: string; icon: LucideIcon };

/** Shared green app bar: brand, area switch, tools, then the section tabs. */
export default function ShellHeader<V extends string>({
  area,
  onSwitchArea,
  tabs,
  view,
  onNavigate,
  label,
  children,
}: {
  area: "tax" | "ledger";
  onSwitchArea?: () => void;
  tabs: readonly Tab<V>[];
  view: string;
  onNavigate: (view: V) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <header className="tx-header">
      <div className="tx-header-bar">
        <Brand />
        {onSwitchArea && <AreaSwitcher area={area} onSwitch={onSwitchArea} />}
        <div className="tx-tools">{children}</div>
      </div>
      <nav className="tx-tabs" aria-label={label}>
        {tabs.map((item) => (
          <button
            key={item.id}
            aria-current={view === item.id ? "page" : undefined}
            className={view === item.id ? "active" : ""}
            onClick={() => onNavigate(item.id)}
          >
            <item.icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}
