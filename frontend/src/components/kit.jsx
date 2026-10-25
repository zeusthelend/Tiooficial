import { Loader2, X } from "lucide-react";

export function Btn({ children, variant = "neon", className = "", ...props }) {
  const base = variant === "neon" ? "neon-btn" : "btn-ghost";
  return (
    <button className={`${base} inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Field({ label, as = "input", children, className = "", ...props }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>}
      {as === "select" ? (
        <select className={`field ${className}`} {...props}>{children}</select>
      ) : as === "textarea" ? (
        <textarea className={`field ${className}`} {...props} />
      ) : (
        <input className={`field ${className}`} {...props} />
      )}
    </label>
  );
}

export function Modal({ open, onClose, title, children, testid }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div data-testid={testid} className="glass card-panel w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-bold">{title}</h3>
          <button data-testid="modal-close" onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ className = "" }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

const SIT = {
  em_andamento: ["Em andamento", "bg-sky-500/15 text-sky-300"],
  reservado: ["Reservado", "bg-amber-500/15 text-amber-300"],
  desistiu: ["Desistiu", "bg-rose-500/15 text-rose-300"],
  concluida: ["Concluída", "bg-emerald-500/15 text-emerald-300"],
  vencido: ["Vencido", "bg-red-600/20 text-red-300"],
  aberta: ["Aberta", "bg-sky-500/15 text-sky-300"],
  resolvida: ["Resolvida", "bg-emerald-500/15 text-emerald-300"],
};
export function StatusBadge({ value }) {
  const [label, cls] = SIT[value] || [value, "bg-secondary text-muted-foreground"];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function EmptyState({ title, hint }) {
  return (
    <div className="glass card-panel p-10 text-center">
      <p className="font-display text-lg">{title}</p>
      {hint && <p className="text-sm text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
