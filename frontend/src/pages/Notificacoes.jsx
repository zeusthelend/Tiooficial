import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Spinner, EmptyState } from "@/components/kit";
import { Bell, Check } from "lucide-react";

export default function Notificacoes() {
  const [items, setItems] = useState(null);

  const load = async () => { const { data } = await api.get("/notificacoes"); setItems(data.notificacoes); };
  useEffect(() => { load(); }, []);

  const markRead = async (n) => {
    if (n.lida) return;
    await api.post(`/notificacoes/${n.id}/lida`);
    setItems((arr) => arr.map((x) => (x.id === n.id ? { ...x, lida: true } : x)));
  };

  return (
    <div className="space-y-5" data-testid="notificacoes-page">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold">Notificações</h1>
        <p className="text-muted-foreground text-sm mt-1">Avisos e eventos do sistema.</p>
      </div>

      {!items ? (
        <div className="grid place-items-center py-16"><Spinner className="w-7 h-7 text-primary" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhuma notificação" hint="Você está em dia!" />
      ) : (
        <div className="space-y-3">
          {items.map((n) => (
            <div key={n.id} onClick={() => markRead(n)}
              className={`glass card-panel p-4 flex items-start gap-3 cursor-pointer transition-all ${n.lida ? "opacity-60" : "neon-ring"}`}
              data-testid={`notif-${n.id}`}>
              <div className="w-9 h-9 rounded-lg grid place-items-center bg-primary/15 shrink-0"><Bell className="w-4 h-4 text-primary" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{n.titulo}</p>
                {n.mensagem && <p className="text-sm text-muted-foreground">{n.mensagem}</p>}
                <p className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString("pt-BR")}</p>
              </div>
              {n.lida && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
