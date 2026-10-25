import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Spinner } from "@/components/kit";
import { FileText, Clock, CheckCircle2, XCircle, AlertTriangle, Boxes, DollarSign, Bookmark } from "lucide-react";

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Stat({ icon: Icon, label, value, accent }) {
  return (
    <div className="glass card-panel p-5 rise">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={`w-5 h-5 ${accent || "text-primary"}`} />
      </div>
      <p className="font-display text-3xl font-bold mt-3">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/dashboard").then(({ data }) => setStats(data.stats)).catch((e) => setErr(e.response?.data?.detail || "Erro ao carregar"));
  }, []);

  if (err) return <div className="glass card-panel p-6 text-rose-400" data-testid="dash-error">{err}</div>;
  if (!stats) return <div className="grid place-items-center py-20"><Spinner className="w-8 h-8 text-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="dashboard">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold">Olá, {user.name.split(" ")[0]} 👋</h1>
        <p className="text-muted-foreground mt-1 text-sm">Visão geral das suas operações.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={FileText} label="Total de DAVs" value={stats.total_davs} />
        <Stat icon={Clock} label="Em andamento" value={stats.em_andamento} accent="text-sky-400" />
        <Stat icon={Bookmark} label="Reservados" value={stats.reservado} accent="text-amber-400" />
        <Stat icon={CheckCircle2} label="Concluídas" value={stats.concluida} accent="text-emerald-400" />
        <Stat icon={XCircle} label="Desistências" value={stats.desistiu} accent="text-rose-400" />
        <Stat icon={AlertTriangle} label="Vencidos" value={stats.vencido} accent="text-red-400" />
        <Stat icon={DollarSign} label="Valor concluído" value={brl(stats.valor_concluido)} accent="text-emerald-400" />
        {stats.ocorrencias_abertas != null && (
          <Stat icon={Boxes} label="Ocorrências abertas" value={stats.ocorrencias_abertas} accent="text-accent" />
        )}
      </div>
    </div>
  );
}
