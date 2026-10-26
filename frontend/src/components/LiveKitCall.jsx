import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { Mic, MicOff, Video, VideoOff, PhoneOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

export default function LiveKitCall({ roomName, conversationId, kind, displayName, onClose }) {
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteMediaRef = useRef(null);
  const roomRef = useRef(null);
  const [status, setStatus] = useState("Conectando ao LiveKit…");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(kind !== "video");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const attachTrack = (track, target) => {
      const element = track.attach();
      element.autoplay = true;
      if (track.kind === Track.Kind.Video) {
        element.className = "w-full h-full object-cover rounded-xl";
        target?.appendChild(element);
      } else {
        element.style.display = "none";
        remoteMediaRef.current?.appendChild(element);
      }
    };
    const onSubscribed = (track) => {
      if (track.kind === Track.Kind.Video) attachTrack(track, remoteVideoRef.current);
      else attachTrack(track, remoteMediaRef.current);
    };
    const onUnsubscribed = (track) => track.detach().forEach((el) => el.remove());
    const onLocalPublished = (publication) => {
      if (publication.track?.kind === Track.Kind.Video && localVideoRef.current) {
        const el = publication.track.attach();
        el.className = "w-full h-full object-cover rounded-xl";
        localVideoRef.current.replaceChildren(el);
      }
    };
    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    room.on(RoomEvent.LocalTrackPublished, onLocalPublished);
    room.on(RoomEvent.Connected, () => setStatus("Conectado"));
    room.on(RoomEvent.Disconnected, () => {
      if (!cancelled) setStatus("Conexão encerrada");
    });

    (async () => {
      try {
        const { data } = await api.post("/chamadas/livekit-token", {
          room: roomName,
          conversation_id: conversationId,
        });
        if (cancelled) return;
        await room.connect(data.url, data.token, { autoSubscribe: true });
        await room.localParticipant.setMicrophoneEnabled(true);
        if (kind === "video") await room.localParticipant.setCameraEnabled(true);
        if (cancelled) return;
        for (const publication of room.localParticipant.videoTrackPublications.values()) {
          if (publication.track && localVideoRef.current) onLocalPublished(publication);
        }
        setStatus("Chamada conectada");
      } catch (e) {
        if (cancelled) return;
        const message = e.response?.data?.detail || e.message || "Falha ao conectar ao LiveKit.";
        setError(message);
        setStatus("Não foi possível conectar");
        toast.error(message);
      }
    })();

    return () => {
      cancelled = true;
      room.removeAllListeners();
      room.disconnect();
      roomRef.current = null;
      localVideoRef.current?.replaceChildren();
      remoteVideoRef.current?.replaceChildren();
      remoteMediaRef.current?.replaceChildren();
    };
  }, [roomName, conversationId, kind]);

  const toggleMic = async () => {
    try {
      const next = !muted;
      await roomRef.current?.localParticipant.setMicrophoneEnabled(!next);
      setMuted(next);
    } catch { toast.error("Não foi possível alterar o microfone."); }
  };
  const toggleCamera = async () => {
    try {
      const next = !cameraOff;
      await roomRef.current?.localParticipant.setCameraEnabled(!next);
      setCameraOff(next);
    } catch { toast.error("Não foi possível alterar a câmera."); }
  };

  return <div className="fixed inset-0 z-[70] bg-slate-950/95 backdrop-blur-md p-3 sm:p-6 flex items-center justify-center">
    <div className="w-full max-w-5xl rounded-3xl border border-white/10 bg-slate-900 shadow-2xl p-4 sm:p-6">
      <header className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-emerald-400/10 text-emerald-300 grid place-items-center"><ShieldCheck className="w-5 h-5"/></div>
        <div className="min-w-0 flex-1"><h2 className="text-white font-bold text-lg">{kind === "video" ? "Chamada de vídeo" : "Chamada de áudio"}</h2><p className="text-sm text-slate-400 truncate">{displayName} · {status}</p></div>
        {status.includes("Conect") && <span className="text-xs text-emerald-300 rounded-full bg-emerald-400/10 px-3 py-1">LiveKit</span>}
      </header>
      {error && <div role="alert" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}<p className="mt-1 text-xs text-rose-200/70">Verifique LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no backend.</p></div>}
      <div className={kind === "video" ? "grid md:grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
        <div className="relative min-h-56 aspect-video rounded-2xl overflow-hidden bg-slate-800 border border-white/10">
          <div ref={remoteVideoRef} className="absolute inset-0"/>
          {kind === "audio" && <div className="absolute inset-0 grid place-items-center"><div className="w-24 h-24 rounded-full bg-emerald-400/10 text-emerald-300 grid place-items-center text-3xl font-bold">{(displayName||"U").slice(0,1).toUpperCase()}</div></div>}
          <span className="absolute bottom-3 left-3 rounded-full bg-black/50 text-white text-xs px-3 py-1">Participante</span>
          {status.includes("Conectando") && <div className="absolute inset-0 grid place-items-center bg-slate-950/30"><LoaderCircle className="w-7 h-7 animate-spin text-emerald-300"/></div>}
        </div>
        {kind === "video" && <div className="relative min-h-56 aspect-video rounded-2xl overflow-hidden bg-slate-800 border border-white/10"><div ref={localVideoRef} className="absolute inset-0"/><span className="absolute bottom-3 left-3 rounded-full bg-black/50 text-white text-xs px-3 py-1">Você</span></div>}
      </div>
      <div ref={remoteMediaRef} className="hidden" aria-hidden="true"/>
      <div className="flex items-center justify-center gap-4 mt-6">
        <button onClick={toggleMic} aria-label={muted ? "Ativar microfone" : "Silenciar microfone"} className={`w-12 h-12 rounded-full grid place-items-center ${muted ? "bg-rose-500 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}>{muted ? <MicOff/> : <Mic/>}</button>
        {kind === "video" && <button onClick={toggleCamera} aria-label={cameraOff ? "Ativar câmera" : "Desligar câmera"} className={`w-12 h-12 rounded-full grid place-items-center ${cameraOff ? "bg-rose-500 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}>{cameraOff ? <VideoOff/> : <Video/>}</button>}
        <button onClick={onClose} aria-label="Encerrar chamada" className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white grid place-items-center shadow-lg shadow-rose-950/50"><PhoneOff/></button>
      </div>
      <p className="text-center text-xs text-slate-500 mt-4">Conexão de mídia via LiveKit. A chamada requer acesso ao microfone e, em vídeo, à câmera.</p>
    </div>
  </div>;
}
