function fmt(preco) {
  if (preco == null) return "Consulte";
  return preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtData(d) {
  if (!d) return null;
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

const TIPO_COLOR = {
  "Apartamento": "bg-blue-100 text-blue-800",
  "Casa": "bg-green-100 text-green-800",
  "Sala Comercial": "bg-purple-100 text-purple-800",
  "Terreno": "bg-amber-100 text-amber-800",
};

export default function ImovelCard({ imovel }) {
  const {
    url, titulo, tipo, bairro, quartos, suites, garagem,
    area_m2, preco, ultima_modificacao, eh_cobertura, eh_terreo,
  } = imovel;

  const tipoColor = TIPO_COLOR[tipo] ?? "bg-gray-100 text-gray-700";

  return (
    <article className="bg-white rounded-xl shadow-sm border border-gray-100
                        hover:shadow-md hover:border-brand-200 transition-all duration-200
                        flex flex-col">
      <div className="p-4 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex flex-wrap gap-1.5">
            {tipo && (
              <span className={`chip text-xs ${tipoColor}`}>{tipo}</span>
            )}
            {eh_cobertura && (
              <span className="chip bg-orange-100 text-orange-700">Cobertura</span>
            )}
            {eh_terreo && !eh_cobertura && (
              <span className="chip bg-teal-100 text-teal-700">Térreo</span>
            )}
          </div>
          {ultima_modificacao && (
            <span className="text-xs text-gray-400 shrink-0">{fmtData(ultima_modificacao)}</span>
          )}
        </div>

        {/* Título */}
        <h3 className="text-sm font-semibold text-gray-800 leading-snug mb-1 line-clamp-2">
          {titulo}
        </h3>

        {/* Bairro */}
        {bairro && (
          <p className="text-xs text-gray-500 mb-3 flex items-center gap-1">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {bairro}
          </p>
        )}

        {/* Specs */}
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          {quartos != null && (
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 12h18M3 6h18M3 18h18" />
              </svg>
              {quartos} {quartos === 1 ? "quarto" : "quartos"}
              {suites ? ` (${suites} suíte${suites > 1 ? "s" : ""})` : ""}
            </span>
          )}
          {garagem != null && (
            <span className="flex items-center gap-1">
              🚗 {garagem} {garagem === 1 ? "vaga" : "vagas"}
            </span>
          )}
          {area_m2 != null && (
            <span className="flex items-center gap-1">
              📐 {area_m2.toLocaleString("pt-BR")} m²
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 pb-4 pt-2 border-t border-gray-50 flex items-center justify-between gap-2">
        <span className="text-base font-bold text-brand-800">{fmt(preco)}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary text-xs py-1.5"
        >
          Ver anúncio →
        </a>
      </div>
    </article>
  );
}
