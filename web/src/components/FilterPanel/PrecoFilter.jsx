import { useFiltersStore } from "../../store/filters";

function fmtMil(v) {
  if (v == null) return "";
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v}`;
}

const PRESETS_MIN = [0, 100_000, 200_000, 300_000, 500_000, 700_000, 1_000_000];
const PRESETS_MAX = [200_000, 300_000, 500_000, 700_000, 1_000_000, 1_500_000, 2_000_000];

export default function PrecoFilter() {
  const precoMin = useFiltersStore((s) => s.precoMin);
  const precoMax = useFiltersStore((s) => s.precoMax);
  const setFiltro = useFiltersStore((s) => s.setFiltro);

  return (
    <div>
      <label className="filter-label">Preço</label>
      <div className="flex gap-2 items-center">
        <select
          value={precoMin ?? ""}
          onChange={(e) => setFiltro("precoMin", e.target.value === "" ? null : Number(e.target.value))}
          className="filter-input"
        >
          <option value="">Mínimo</option>
          {PRESETS_MIN.map((v) => (
            <option key={v} value={v}>{fmtMil(v)}</option>
          ))}
        </select>
        <span className="text-gray-400 text-sm shrink-0">–</span>
        <select
          value={precoMax ?? ""}
          onChange={(e) => setFiltro("precoMax", e.target.value === "" ? null : Number(e.target.value))}
          className="filter-input"
        >
          <option value="">Máximo</option>
          {PRESETS_MAX.map((v) => (
            <option key={v} value={v}>{fmtMil(v)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
