import { useMemo, useState } from "react";
import { SKINS, SKIN_MAP } from "../theme/skins";
import { applySkin } from "../theme/theme-engine";
import { getRoot, getStoredSkin, setSkin } from "../theme/useTheme";

/**
 * Appearance / skin selector (UI-only). Lets the user rebrand the whole popup
 * live by swapping the active white-label skin. The choice persists to
 * localStorage (via setSkin) and re-applies the token set to the popup root
 * immediately, so the entire UI restyles without a reload. Default stays
 * "evolved" — the shipped dark bottom-nav skin.
 */
export function AppearancePanel() {
  const [skin, setSkinState] = useState<string>(() => getStoredSkin());

  // Group skins by their `group` (Base / Brand) for the <optgroup> sections.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, typeof SKINS>();
    for (const spec of SKINS) {
      if (!byGroup.has(spec.group)) {
        byGroup.set(spec.group, []);
        order.push(spec.group);
      }
      byGroup.get(spec.group)!.push(spec);
    }
    return order.map((group) => ({ group, skins: byGroup.get(group)! }));
  }, []);

  function onChange(id: string) {
    setSkinState(id);
    // Persist (writes localStorage + applies internally)…
    setSkin(id);
    // …and re-apply explicitly so the whole popup rebrands instantly.
    applySkin(getRoot(), SKIN_MAP[id]);
  }

  return (
    <section className="stack">
      <label className="field">
        Appearance
        <select value={skin} onChange={(event) => onChange(event.target.value)}>
          {grouped.map(({ group, skins }) => (
            <optgroup key={group} label={group}>
              {skins.map((spec) => (
                <option key={spec.id} value={spec.id}>{spec.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </section>
  );
}
