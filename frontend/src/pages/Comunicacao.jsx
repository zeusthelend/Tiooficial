import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import LiveKitCall from "@/components/LiveKitCall";
import { useAuth } from "@/context/AuthContext";
import { Btn, EmptyState, Spinner } from "@/components/kit";
import { MessageCircle, Phone, Video, Send, Search, Users, Mic, MicOff, VideoOff, PhoneOff, Paperclip, Circle, ArrowLeft, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const initials = (name = "") => name.split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();
const time = (date) => date ? new Date(date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "";

export default function Comunicacao() {
  const { user } = useAuth();
  const [people,setPeople] = useState([]);
  const [conversations,setConversations] = useState([]);
  const [active,setActive] = useState(null);
  const [messages,setMessages] = useState([]);
  const [draft,setDraft] = useState("");
  const [search,setSearch] = useState("");
  const [loading,setLoading] = useState(true);
  const [sending,setSending] = useState(false);
  const [call,setCall] = useState(null);
  const [muted,setMuted] = useState(false);
  const [cameraOff,setCameraOff] = useState(false);
  const [callStatus,setCallStatus] = useState("");
  const [remoteName,setRemoteName] = useState("");
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const peer = useRef(null);
  const localStream = useRef(null);
  const activeRef = useRef(null);
  const lastSignal = useRef(null);
  const scrollRef = useRef(null);

  const loadBase = useCallback(async()=>{
    setLoading(true);
    try {
      const [u,c] = await Promise.all([api.get("/users/vendedores"),api.get("/conversas")]);
      setPeople((u.data.vendedores||[]).filter(p=>p.id!==user.id));
      setConversations(c.data.conversas||[]);
    } catch(e) { toast.error(e.response?.data?.detail || "Não foi possível carregar a comunicação."); }
    finally { setLoading(false); }
  },[user?.id]);

  useEffect(()=>{ loadBase(); },[loadBase]);
  useEffect(()=>{ activeRef.current=active; },[active]);
  useEffect(()=>{ scrollRef.current?.scrollIntoView({behavior:"smooth",block:"end"}); },[messages]);

  const loadMessages = useCallback(async(cid)=>{
    try { const {data}=await api.get(`/conversas/${cid}/mensagens`); setMessages(data.mensagens||[]); }
    catch(e){ toast.error(e.response?.data?.detail || "Não foi possível abrir as mensagens."); }
  },[]);
  useEffect(()=>{
    if(!active) { setMessages([]); return; }
    loadMessages(active.id);
    const id=setInterval(()=>loadMessages(active.id),3500);
    return ()=>clearInterval(id);
  },[active?.id,loadMessages]);

  const openChat = async(person)=>{
    try {
      let conv=conversations.find(c=>(c.participant_ids||[]).includes(person.id));
      if(!conv) {
        const {data}=await api.post("/conversas",{participant_id:person.id});
        conv=data.conversa; setConversations(old=>[conv,...old]);
      }
      setActive({...conv, other:person});
      setRemoteName(person.name);
    } catch(e){ toast.error(e.response?.data?.detail || "Não foi possível iniciar a conversa."); }
  };
  const otherId = active ? (active.participant_ids||[]).find(id=>id!==user.id) : null;
  const activePerson = active?.other || people.find(p=>p.id===otherId) || {name:"Conversa",id:otherId};

  const sendMessage=async(e)=>{
    e?.preventDefault(); const body=draft.trim();
    if(!body||!active||sending) return;
    setSending(true);
    try { const {data}=await api.post(`/conversas/${active.id}/mensagens`,{body}); setMessages(old=>[...old,data.mensagem]); setDraft(""); }
    catch(err){ toast.error(err.response?.data?.detail || "Falha ao enviar mensagem."); }
    finally{setSending(false);}
  };

  const sendSignal=async(type,payload,to=otherId,cid=activeRef.current?.id)=>{
    if(!cid||!to) return;
    await api.post(`/conversas/${cid}/chamadas/sinais`,{to_user:to,signal_type:type,payload});
  };
  const cleanupCall=async(notify=true)=>{
    const current=call;
    if(notify&&current) {
      try { await sendSignal("hangup",null,current.to,current.conversationId); } catch {}
    }
    setCall(null);
    setCallStatus("");
    setMuted(false);
    setCameraOff(false);
  };
  const startCall=async(kind)=>{
    if(!active){toast.error("Abra uma conversa antes de ligar.");return;}
    if(!globalThis.crypto?.randomUUID){toast.error("Este navegador não oferece suporte seguro para iniciar chamadas.");return;}
    const roomName=`tio-${active.id}-${crypto.randomUUID()}`;
    try {
      setCall({kind,direction:"outgoing",to:otherId,conversationId:active.id,roomName});
      setCallStatus("Chamando…");
      await sendSignal("offer",{room:roomName,kind},otherId,active.id);
    } catch(e) {
      setCall(null);
      toast.error(e.response?.data?.detail || "Não foi possível iniciar a chamada.");
    }
  };
  const answerCall=async(signal)=>{
    const roomName=signal.payload?.room;
    if(!roomName){toast.error("O convite de chamada não contém uma sala LiveKit válida.");return;}
    setCall({kind:signal.payload?.kind==="video"?"video":"audio",direction:"incoming",to:signal.from_user,conversationId:signal.conversation_id,roomName});
    setCallStatus("Conectando ao LiveKit…");
    try {
      await api.post(`/conversas/${signal.conversation_id}/chamadas/sinais`,{to_user:signal.from_user,signal_type:"answer",payload:{room:roomName}});
    } catch(e) {
      setCall(null);
      toast.error(e.response?.data?.detail || "Não foi possível aceitar a chamada.");
    }
  };
  useEffect(()=>{
    let live=true;
    const poll=async()=>{
      try{
        const {data}=await api.get("/chamadas/sinais");
        for(const s of data.sinais||[]){
          if(!live) return;
          if(s.signal_type==="offer"&&!call) {
            const p=people.find(x=>x.id===s.from_user);
            setRemoteName(p?.name||"Funcionário");
            const accept=window.confirm(`Chamada de ${p?.name||"funcionário"} (${s.payload?.kind==="video"?"vídeo":"áudio"}). Deseja atender?`);
            if(accept) await answerCall(s);
            else await api.post(`/conversas/${s.conversation_id}/chamadas/sinais`,{to_user:s.from_user,signal_type:"decline",payload:null});
          } else if(call && s.conversation_id===call.conversationId && s.from_user===call.to){
            if(s.signal_type==="answer"){setCallStatus("A outra pessoa aceitou a chamada.");}
            if(["hangup","decline","busy"].includes(s.signal_type)){toast.message(s.signal_type==="decline"?"A chamada foi recusada.":"A chamada foi encerrada.");await cleanupCall(false);}
          }
        }
      }catch{}
    };
    const id=setInterval(poll,1200);
    return()=>{live=false;clearInterval(id);};
  },[people,call]);

  const visiblePeople=people.filter(p=>(p.name||"").toLowerCase().includes(search.toLowerCase()));
  if(loading) return <div className="grid place-items-center py-24"><Spinner className="w-8 h-8 text-primary"/></div>;

  return <div className="space-y-5" data-testid="communication-page">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-[.18em]"><ShieldCheck className="w-4 h-4"/> Comunicação interna</div><h1 className="font-display text-3xl sm:text-4xl font-bold mt-2">Central de comunicação</h1><p className="text-muted-foreground text-sm mt-1">Mensagens e chamadas de áudio e vídeo da equipe.</p></div>
      <div className="badge bg-emerald-500/10 text-emerald-300"><Circle className="w-2 h-2 fill-current"/> Ambiente protegido</div>
    </div>
    <div className="glass rounded-2xl overflow-hidden border border-white/5 min-h-[620px] grid lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={`border-r border-border flex-col ${active?"hidden lg:flex":"flex"}`}>
        <div className="p-4 border-b border-border"><div className="flex items-center gap-2 mb-3"><MessageCircle className="w-5 h-5 text-primary"/><h2 className="font-bold">Conversas</h2><span className="ml-auto badge bg-primary/10 text-primary">{conversations.length}</span></div><div className="relative"><Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground"/><input className="field pl-9" placeholder="Buscar funcionário…" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
        <div className="p-2 overflow-y-auto max-h-[530px]">
          {visiblePeople.map(p=><button key={p.id} onClick={()=>openChat(p)} className={`w-full p-3 rounded-xl flex items-center gap-3 text-left hover:bg-secondary/70 transition-colors ${activePerson.id===p.id&&active?"bg-primary/10 neon-ring":""}`}><div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400/30 to-cyan-400/20 grid place-items-center font-bold text-primary shrink-0">{initials(p.name)}</div><div className="min-w-0 flex-1"><p className="font-semibold text-sm truncate">{p.name}</p><p className="text-xs text-muted-foreground">Equipe Shopping Hospitalar</p></div><span className="w-2 h-2 rounded-full bg-emerald-400/80"/></button>)}
          {visiblePeople.length===0&&<p className="text-center text-sm text-muted-foreground py-8"><Users className="w-5 h-5 mx-auto mb-2"/>Nenhum funcionário encontrado.</p>}
        </div>
      </aside>
      <section className={`min-w-0 flex-col ${active?"flex":"hidden lg:flex"}`}>
        {active?<><header className="p-4 border-b border-border flex items-center gap-3"><button className="lg:hidden btn-ghost !p-2" onClick={()=>setActive(null)}><ArrowLeft className="w-4 h-4"/></button><div className="w-10 h-10 rounded-full bg-primary/15 text-primary grid place-items-center font-bold">{initials(activePerson.name)}</div><div className="flex-1 min-w-0"><h2 className="font-bold truncate">{activePerson.name}</h2><p className="text-xs text-muted-foreground">Conversa privada • mensagens atualizadas automaticamente</p></div><button className="btn-ghost !p-2" title="Chamada de áudio" onClick={()=>startCall("audio")}><Phone className="w-4 h-4"/></button><button className="neon-btn !p-2" title="Chamada de vídeo" onClick={()=>startCall("video")}><Video className="w-4 h-4"/></button></header>
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-3 min-h-[390px] max-h-[520px]">{messages.map(m=><div key={m.id} className={`flex ${m.sender_id===user.id?"justify-end":"justify-start"}`}><div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3 ${m.sender_id===user.id?"bg-primary/15 border border-primary/20 rounded-br-sm":"bg-secondary/80 rounded-bl-sm"}`}><p className="text-sm whitespace-pre-wrap break-words">{m.body}</p><p className="text-[10px] text-muted-foreground text-right mt-1">{time(m.created_at)}{m.sender_id===user.id?" · Você":""}</p></div></div>)}{messages.length===0&&<div className="grid place-items-center h-full min-h-[280px]"><EmptyState title="Sua conversa começa aqui" hint="Envie uma mensagem segura para seu colega."/></div>}<div ref={scrollRef}/></div>
          <form onSubmit={sendMessage} className="p-3 sm:p-4 border-t border-border"><div className="flex items-end gap-2"><textarea className="field resize-none min-h-[46px] max-h-32" rows={1} placeholder="Digite sua mensagem…" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(e);}}}/><button className="neon-btn !p-3" disabled={!draft.trim()||sending} aria-label="Enviar mensagem">{sending?<Spinner className="w-4 h-4"/>:<Send className="w-4 h-4"/>}</button></div><p className="text-[10px] text-muted-foreground mt-2">Enter para enviar • Shift + Enter para nova linha</p></form>
        </>:<div className="flex-1 grid place-items-center p-8 text-center"><div className="max-w-md"><div className="w-20 h-20 mx-auto rounded-3xl bg-primary/10 neon-ring grid place-items-center"><MessageCircle className="w-9 h-9 text-primary"/></div><h2 className="font-display text-2xl font-bold mt-6">Fale com sua equipe</h2><p className="text-sm text-muted-foreground mt-2">Escolha um funcionário para conversar, ou inicie uma chamada de áudio ou vídeo com um toque.</p><div className="grid grid-cols-3 gap-3 mt-7"><div className="glass rounded-xl p-3"><MessageCircle className="w-5 h-5 mx-auto text-primary"/><p className="text-xs mt-2">Chat</p></div><div className="glass rounded-xl p-3"><Phone className="w-5 h-5 mx-auto text-primary"/><p className="text-xs mt-2">Áudio</p></div><div className="glass rounded-xl p-3"><Video className="w-5 h-5 mx-auto text-primary"/><p className="text-xs mt-2">Vídeo</p></div></div></div></div>}
      </section>
    </div>
    {call&&<LiveKitCall roomName={call.roomName} conversationId={call.conversationId} kind={call.kind} displayName={remoteName||activePerson.name} onClose={()=>cleanupCall()}/>}
  </div>;
}
