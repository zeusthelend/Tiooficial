"""Secure chat and WebRTC signaling endpoints for the Tiooficial app.
Requires the additive SQL migration in supabase_migration_communication.sql.
"""
from datetime import datetime, timezone
import os
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field
from fastapi import Depends, HTTPException, Query

from server import api, sb, get_current_user


class ConversationIn(BaseModel):
    participant_id: UUID
    title: Optional[str] = Field(default=None, max_length=120)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class SignalIn(BaseModel):
    to_user: UUID
    signal_type: str
    payload: Optional[dict] = None


def _conversation(cid: str, user: dict):
    rows = sb("GET", "sh_conversations", {"id": f"eq.{cid}", "select": "*"}, token=user["_token"])
    if not rows or user["id"] not in rows[0].get("participant_ids", []):
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    return rows[0]


@api.get("/conversas")
def conversations(user: dict = Depends(get_current_user)):
    rows = sb("GET", "sh_conversations", {"select": "*", "participant_ids": f"cs.{{{user['id']}}}", "order": "created_at.desc"}, token=user["_token"])
    return {"conversas": rows}


@api.post("/conversas")
def create_conversation(body: ConversationIn, user: dict = Depends(get_current_user)):
    if str(body.participant_id) == user["id"]:
        raise HTTPException(status_code=400, detail="Escolha outra pessoa para iniciar uma conversa.")
    target = sb("GET", "profiles", {"id": f"eq.{body.participant_id}", "select": "id,active,approved"})
    if not target or target[0].get("active") is False or not target[0].get("approved"):
        raise HTTPException(status_code=404, detail="Funcionário não encontrado ou sem acesso ativo.")
    participants = [user["id"], str(body.participant_id)]
    existing = sb("GET", "sh_conversations", {"select": "*", "participant_ids": f"cs.{{{user['id']},{body.participant_id}}}", "limit": "50"}, token=user["_token"])
    for item in existing:
        if set(item.get("participant_ids", [])) == set(participants):
            return {"conversa": item}
    rows = sb("POST", "sh_conversations", json={"participant_ids": participants, "created_by": user["id"], "title": body.title}, prefer="return=representation", token=user["_token"])
    if not rows:
        raise HTTPException(status_code=403, detail="Não foi possível criar a conversa.")
    return {"conversa": rows[0]}


@api.get("/conversas/{cid}/mensagens")
def list_messages(cid: str, user: dict = Depends(get_current_user), after: Optional[datetime] = None):
    _conversation(cid, user)
    params = {"select": "*", "conversation_id": f"eq.{cid}", "order": "created_at.asc", "limit": "200"}
    if after:
        params["created_at"] = f"gt.{after.isoformat()}"
    return {"mensagens": sb("GET", "sh_messages", params, token=user["_token"])}


@api.post("/conversas/{cid}/mensagens")
def send_message(cid: str, body: MessageIn, user: dict = Depends(get_current_user)):
    _conversation(cid, user)
    rows = sb("POST", "sh_messages", json={"conversation_id": cid, "sender_id": user["id"], "body": body.body.strip()}, prefer="return=representation", token=user["_token"])
    if not rows:
        raise HTTPException(status_code=403, detail="Não foi possível enviar a mensagem.")
    return {"mensagem": rows[0]}


@api.get("/chamadas/sinais")
def incoming_signals(user: dict = Depends(get_current_user), after: Optional[datetime] = None):
    params = {"select": "*", "to_user": f"eq.{user['id']}", "consumed_at": "is.null", "order": "created_at.asc", "limit": "100"}
    if after:
        params["created_at"] = f"gt.{after.isoformat()}"
    rows = sb("GET", "sh_call_signals", params, token=user["_token"])
    if rows:
        ids = ",".join(r["id"] for r in rows)
        sb("PATCH", "sh_call_signals", {"id": f"in.({ids})", "to_user": f"eq.{user['id']}"}, {"consumed_at": datetime.now(timezone.utc).isoformat()}, token=user["_token"])
    return {"sinais": rows}


@api.post("/conversas/{cid}/chamadas/sinais")
def send_signal(cid: str, body: SignalIn, user: dict = Depends(get_current_user)):
    conversation = _conversation(cid, user)
    if str(body.to_user) not in conversation.get("participant_ids", []):
        raise HTTPException(status_code=400, detail="Destinatário não pertence à conversa.")
    if body.signal_type not in {"offer", "answer", "ice", "hangup", "decline", "busy"}:
        raise HTTPException(status_code=400, detail="Sinal de chamada inválido.")
    rows = sb("POST", "sh_call_signals", json={"conversation_id": cid, "from_user": user["id"], "to_user": str(body.to_user), "signal_type": body.signal_type, "payload": body.payload}, prefer="return=representation", token=user["_token"])
    if not rows:
        raise HTTPException(status_code=403, detail="Não foi possível enviar o sinal da chamada.")
    return {"sinal": rows[0]}


@api.get("/chamadas/ice-servers")
def ice_servers(user: dict = Depends(get_current_user)):
    # Configure TURN_URL, TURN_USERNAME and TURN_CREDENTIAL in the deployment environment.
    servers = [{"urls": ["stun:stun.l.google.com:19302"]}]
    turn_url = os.environ.get("TURN_URL")
    turn_username = os.environ.get("TURN_USERNAME")
    turn_credential = os.environ.get("TURN_CREDENTIAL")
    if turn_url and turn_username and turn_credential:
        servers.append({"urls": [u.strip() for u in turn_url.split(",") if u.strip()],
                        "username": turn_username, "credential": turn_credential})
    return {"iceServers": servers, "turnConfigured": len(servers) > 1}
