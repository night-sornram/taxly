import { Landmark, TrendingUp } from "lucide-react";

const areas = [
  { id: "tax", label: "ภาษี", name: "ภาษีของฉัน", icon: Landmark },
  { id: "wealth", label: "ลงทุน", name: "การลงทุนของฉัน", icon: TrendingUp },
] as const;

export default function AreaSwitcher({
  area,
  onSwitch,
}: {
  area: "tax" | "wealth";
  onSwitch: () => void;
}) {
  return (
    <div className="area-switcher" role="group" aria-label="เลือกส่วนการใช้งาน">
      {areas.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={item.name}
          aria-pressed={area === item.id}
          onClick={() => {
            if (area !== item.id) onSwitch();
          }}
        >
          <item.icon size={17} aria-hidden="true" />
          {item.label}
        </button>
      ))}
    </div>
  );
}
