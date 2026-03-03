import { useFiltersStore } from "../../store/filters";

const PRESETS_MIN = [0, 40, 60, 80, 100, 150, 200];
const PRESETS_MAX = [60, 80, 100, 150, 200, 300, 500];

export default function AreaFilter() {
  const areaMin = useFiltersStore((s) => s.areaMin);
  const areaMax = useFiltersStore((s) => s.areaMax);
  const setFiltro = useFiltersStore((s) => s.setFiltro);

  return (
    <div>
      <label className="filter-label">Área (m²)</label>
      <div className="flex gap-2 items-center">
        <select
          value={areaMin ?? ""}
          onChange={(e) => setFiltro("areaMin", e.target.value === "" ? null : Number(e.target.value))}
          className="filter-input"
        >
          <option value="">Mínimo</option>
          {PRESETS_MIN.map((v) => (
            <option key={v} value={v}>{v} m²</option>
          ))}
        </select>
        <span className="text-gray-400 text-sm shrink-0">–</span>
        <select
          value={areaMax ?? ""}
          onChange={(e) => setFiltro("areaMax", e.target.value === "" ? null : Number(e.target.value))}
          className="filter-input"
        >
          <option value="">Máximo</option>
          {PRESETS_MAX.map((v) => (
            <option key={v} value={v}>{v} m²</option>
          ))}
        </select>
      </div>
    </div>
  );
}
