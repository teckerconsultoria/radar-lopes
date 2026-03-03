import { useFiltersStore } from "../../store/filters";

export default function CaracteristicasFilter({ caracteristicas }) {
  const selected = useFiltersStore((s) => s.caracteristicas);
  const toggle = useFiltersStore((s) => s.toggleCaracteristica);

  if (!caracteristicas?.length) return null;

  return (
    <div>
      <label className="filter-label">Características</label>
      <div className="flex flex-wrap gap-1.5">
        {caracteristicas.map((c) => (
          <button
            key={c}
            onClick={() => toggle(c)}
            className={`chip text-xs ${selected.includes(c) ? "chip-active" : "chip-inactive"}`}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
