import { useState, useEffect, useRef } from "react";
import { buscarImoveis } from "../lib/queries";
import { useFiltersStore } from "../store/filters";

export function useImoveis() {
  const [imoveis, setImoveis] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const filters = useFiltersStore((s) => ({
    texto: s.texto,
    tipos: s.tipos,
    bairros: s.bairros,
    quartosMin: s.quartosMin,
    quartosMax: s.quartosMax,
    suitesMin: s.suitesMin,
    garagemMin: s.garagemMin,
    precoMin: s.precoMin,
    precoMax: s.precoMax,
    areaMin: s.areaMin,
    areaMax: s.areaMax,
    andar: s.andar,
    ehTerreo: s.ehTerreo,
    caracteristicas: s.caracteristicas,
    diasAtualizacao: s.diasAtualizacao,
  }));

  const sortBy = useFiltersStore((s) => s.sortBy);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const { data, count: total, error: err } = await buscarImoveis(filters, sortBy);
      setImoveis(data);
      setCount(total);
      setError(err);
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [JSON.stringify(filters), sortBy]);

  return { imoveis, count, loading, error };
}
