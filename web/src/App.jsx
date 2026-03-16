import ChatPanel from "./components/ChatPanel";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-brand-900 text-white shadow-lg shrink-0">
        <div className="max-w-screen-xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold leading-tight">Radar Lopes</h1>
              <p className="text-brand-200 text-xs">Lopes de Andrade Imóveis</p>
            </div>
          </div>
        </div>
      </header>

      {/* Chat ocupa o restante da tela */}
      <main className="flex-1 flex flex-col min-h-0">
        <ChatPanel />
      </main>
    </div>
  );
}
