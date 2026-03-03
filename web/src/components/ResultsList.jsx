import ImovelCard from "./ImovelCard";
import EmptyState from "./EmptyState";

export default function ResultsList({ imoveis, loading }) {
  if (!loading && imoveis.length === 0) {
    return <EmptyState loading={loading} />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {imoveis.map((imovel) => (
        <ImovelCard key={imovel.id} imovel={imovel} />
      ))}
    </div>
  );
}
