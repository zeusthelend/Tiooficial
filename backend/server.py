import os
import time
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from pathlib import Path

import jwt
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

load_dotenv(Path(__file__).parent / ".env")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("shopping_hospitalar")

SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ADMIN_PIN = os.environ["ADMIN_PIN"]
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

SB_HEADERS = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}
http = httpx.Client(timeout=20)

ROLES = ["admin", "diretor", "gerente", "funcionario"]
MANAGEMENT = ["admin", "diretor", "gerente"]
STOCK_POSITIONS = ["Estoque", "Encarregado de Estoque"]
DAV_STATUS = ["aberto", "em_andamento", "concluido", "cancelado"]


def sb(method: str, table: str, params: Optional[dict] = None, json=None, prefer: Optional[str] = None,
       token: Optional[str] = None):
    headers = dict(SB_HEADERS)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if prefer:
        headers["Prefer"] = prefer
    r = http.request(method, f"{SB_URL}/rest/v1/{table}", params=params, json=json, headers=headers)
    if r.status_code >= 400:
        logger.error(f"Supabase {method} {table}: {r.status_code} {r.text[:300]}")
        if r.status_code in (401, 403) or r.status_code == 400 and token:
            raise HTTPException(status_code=403, detail="Operação não permitida para o seu perfil.")
        raise HTTPException(status_code=502, detail="Erro ao acessar o banco de dados.")
    return r.json() if r.content else None


def rpc(name: str, body: dict, token: str):
    return sb("POST", f"rpc/{name}", json=body, token=token)


def sb_auth(method: str, path: str, json=None, token: Optional[str] = None):
    headers = {"apikey": SB_KEY, "Content-Type": "application/json",
               "Authorization": f"Bearer {token or SB_KEY}"}
    return http.request(method, f"{SB_URL}/auth/v1/{path}", json=json, headers=headers)


app = FastAPI(title="Shopping Hospitalar API")
api = APIRouter(prefix="/api")

# ----------------- helpers -----------------
_attempts = {}


def check_lock(key):
    rec = _attempts.get(key)
    if rec and rec["count"] >= 5 and time.time() - rec["ts"] < 900:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Tente novamente em 15 minutos.")


def fail_attempt(key):
    rec = _attempts.get(key, {"count": 0, "ts": time.time()})
    rec["count"] += 1
    rec["ts"] = time.time()
    _attempts[key] = rec


def lookup_maps():
    pos = {p["id"]: p["name"] for p in sb("GET", "positions", {"select": "id,name"})}
    dep = {d["id"]: d["name"] for d in sb("GET", "departments", {"select": "id,name"})}
    return pos, dep


def load_user(uid: str) -> Optional[dict]:
    rows = sb("GET", "profiles", {"id": f"eq.{uid}", "select": "*"})
    if not rows:
        return None
    p = rows[0]
    roles = [r["role"] for r in sb("GET", "user_roles", {"user_id": f"eq.{uid}", "select": "role"})]
    role = next((r for r in ROLES if r in roles), "funcionario")
    pos, dep = lookup_maps()
    position = pos.get(p.get("position_id"))
    return {
        "id": p["id"], "email": p.get("email"), "name": p.get("full_name") or p.get("email"),
        "phone": p.get("phone"), "avatar_url": p.get("avatar_url"), "role": role,
        "position": position, "department": dep.get(p.get("department_id")),
        "position_id": p.get("position_id"), "department_id": p.get("department_id"),
        "active": p.get("active"), "approved": p.get("approved"),
        "is_manager": role in MANAGEMENT,
        "can_stock": role in MANAGEMENT or position in STOCK_POSITIONS,
    }


def check_access(user: dict):
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="Acesso desativado. Contate o administrador.")
    if not user.get("approved"):
        raise HTTPException(status_code=403, detail="Cadastro aguardando aprovação do administrador.")


def set_auth_cookies(response: Response, session: dict):
    opts = dict(httponly=True, secure=True, samesite="none", path="/")
    response.set_cookie("sb_access", session["access_token"], max_age=60 * 60 * 24 * 7, **opts)
    response.set_cookie("sb_refresh", session["refresh_token"], max_age=60 * 60 * 24 * 30, **opts)


def token_uid(token: str) -> Optional[str]:
    try:
        return jwt.decode(token, options={"verify_signature": False}, algorithms=["HS256", "ES256", "RS256"])["sub"]
    except Exception:
        return None


def session_user(request: Request, response: Response) -> dict:
    token = request.cookies.get("sb_access")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    r = sb_auth("GET", "user", token=token)
    if r.status_code != 200:
        refresh = request.cookies.get("sb_refresh")
        rr = sb_auth("POST", "token?grant_type=refresh_token", {"refresh_token": refresh}) if refresh else None
        if not rr or rr.status_code != 200:
            raise HTTPException(status_code=401, detail="Sessão expirada")
        session = rr.json()
        set_auth_cookies(response, session)
        token = session["access_token"]
    user = load_user(token_uid(token))
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="Acesso desativado. Contate o administrador.")
    user["_token"] = token
    return user


def get_current_user(user: dict = Depends(session_user)) -> dict:
    check_access(user)
    return user


def public(user: dict) -> dict:
    return {k: v for k, v in user.items() if not k.startswith("_")}


def require_roles(user, roles):
    if user["role"] not in roles:
        raise HTTPException(status_code=403, detail="Você não tem permissão para esta ação.")


def require_pin(pin: Optional[str], user: dict):
    key = f"pin:{user['id']}"
    check_lock(key)
    if not pin or pin != ADMIN_PIN:
        fail_attempt(key)
        raise HTTPException(status_code=401, detail="PIN de segurança incorreto.")
    _attempts.pop(key, None)


# ----------------- Models -----------------
class LoginIn(BaseModel):
    email: str
    password: str


class PinIn(BaseModel):
    pin: str


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "funcionario"
    phone: Optional[str] = None
    position_id: Optional[str] = None
    department_id: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    phone: Optional[str] = None
    position_id: Optional[str] = None
    department_id: Optional[str] = None
    active: Optional[bool] = None
    approved: Optional[bool] = None
    password: Optional[str] = None
    pin: Optional[str] = None


class DavIn(BaseModel):
    dav_number: str
    client_name: Optional[str] = None
    seller_id: Optional[str] = None
    category: str = "dav"
    due_at: Optional[str] = None
    description: Optional[str] = None
    dav_value: float = 0
    status: str = "aberto"


class DavUpdate(BaseModel):
    dav_number: Optional[str] = None
    client_name: Optional[str] = None
    category: Optional[str] = None
    due_at: Optional[str] = None
    description: Optional[str] = None
    dav_value: Optional[float] = None
    status: Optional[str] = None


class StockIn(BaseModel):
    title: str
    notes: Optional[str] = None
    due_at: Optional[str] = None


class StockUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    due_at: Optional[str] = None
    completed: Optional[bool] = None


class AnnouncementIn(BaseModel):
    title: str
    body: Optional[str] = None
    important: bool = False


class AiIn(BaseModel):
    message: str


# ----------------- Auth -----------------
@api.get("/")
def root():
    return {"app": "Shopping Hospitalar", "status": "ok"}


@api.get("/health")
def health():
    sb("GET", "app_settings", {"select": "id", "limit": "1"})
    return {"status": "ok", "database": "supabase"}


@api.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower().strip()
    key = f"{request.client.host}:{email}"
    check_lock(key)
    r = sb_auth("POST", "token?grant_type=password", {"email": email, "password": body.password})
    if r.status_code != 200:
        fail_attempt(key)
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
    session = r.json()
    user = load_user(session["user"]["id"])
    if not user:
        raise HTTPException(status_code=403, detail="Perfil não encontrado. Contate o administrador.")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="Acesso desativado. Contate o administrador.")
    _attempts.pop(key, None)
    set_auth_cookies(response, session)
    return {"user": user, "token": session["access_token"]}


@api.post("/auth/logout")
def logout(response: Response):
    for c in ("sb_access", "sb_refresh"):
        response.delete_cookie(c, path="/", secure=True, samesite="none")
    return {"ok": True}


@api.get("/auth/me")
def me(user: dict = Depends(session_user)):
    return {"user": public(user)}


@api.post("/auth/access-pin")
def redeem_access(body: PinIn, user: dict = Depends(session_user)):
    key = f"access:{user['id']}"
    check_lock(key)
    if not rpc("redeem_access_pin", {"_pin": body.pin.strip()}, user["_token"]):
        fail_attempt(key)
        raise HTTPException(status_code=400, detail="PIN de acesso inválido ou expirado.")
    _attempts.pop(key, None)
    return {"user": public(load_user(user["id"]))}


@api.post("/access-pins")
def create_access(body: dict, user: dict = Depends(get_current_user)):
    require_roles(user, MANAGEMENT)
    pin = rpc("create_access_pin", {"_label": (body.get("label") or "Novo funcionário")[:80]}, user["_token"])
    return {"pin": pin}


@api.post("/auth/pin/verify")
def verify_pin(body: PinIn, user: dict = Depends(get_current_user)):
    require_pin(body.pin, user)
    return {"ok": True}


# ----------------- Funcionarios -----------------
@api.get("/meta")
def meta(user: dict = Depends(get_current_user)):
    return {"positions": sb("GET", "positions", {"select": "id,name", "order": "name"}),
            "departments": sb("GET", "departments", {"select": "id,name", "order": "name"})}


@api.get("/users")
def list_users(user: dict = Depends(get_current_user)):
    require_roles(user, MANAGEMENT)
    profiles = sb("GET", "profiles", {"select": "*", "order": "full_name"})
    roles = {r["user_id"]: r["role"] for r in sb("GET", "user_roles", {"select": "user_id,role"})}
    pos, dep = lookup_maps()
    return {"users": [{
        "id": p["id"], "email": p.get("email"), "name": p.get("full_name"), "phone": p.get("phone"),
        "role": roles.get(p["id"], "funcionario"), "position_id": p.get("position_id"),
        "department_id": p.get("department_id"), "position": pos.get(p.get("position_id")),
        "department": dep.get(p.get("department_id")), "active": p.get("active"),
        "approved": p.get("approved"), "status": p.get("status"),
    } for p in profiles]}


@api.get("/users/vendedores")
def list_vendedores(user: dict = Depends(get_current_user)):
    rows = sb("GET", "profiles", {"select": "id,full_name,email", "active": "eq.true",
                                  "approved": "eq.true", "order": "full_name"})
    return {"vendedores": [{"id": r["id"], "name": r.get("full_name") or r.get("email")} for r in rows]}


def set_role(uid: str, role: str):
    if role not in ROLES:
        raise HTTPException(status_code=400, detail="Cargo inválido.")
    if sb("GET", "user_roles", {"user_id": f"eq.{uid}", "select": "id"}):
        sb("PATCH", "user_roles", {"user_id": f"eq.{uid}"}, {"role": role})
    else:
        sb("POST", "user_roles", json={"user_id": uid, "role": role})


@api.post("/users")
def create_user(body: UserCreate, user: dict = Depends(get_current_user)):
    require_roles(user, ["admin"])
    if body.role not in ROLES:
        raise HTTPException(status_code=400, detail="Cargo inválido.")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="A senha deve ter ao menos 6 caracteres.")
    email = body.email.lower().strip()
    r = sb_auth("POST", "admin/users", {"email": email, "password": body.password,
                                         "email_confirm": True, "user_metadata": {"full_name": body.name}})
    if r.status_code >= 400:
        msg = r.json().get("msg") or r.json().get("message") or ""
        if "already" in msg.lower():
            raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail.")
        raise HTTPException(status_code=400, detail="Não foi possível criar o usuário.")
    uid = r.json()["id"]
    sb("PATCH", "profiles", {"id": f"eq.{uid}"}, {"full_name": body.name, "phone": body.phone,
                                                   "department_id": body.department_id or None})
    set_role(uid, body.role)
    if body.position_id:
        rpc("set_member_position", {"_member": uid, "_position": body.position_id}, user["_token"])
    pin = rpc("create_access_pin", {"_label": f"Cadastro {email}"[:80]}, user["_token"])
    s2 = sb_auth("POST", "token?grant_type=password", {"email": email, "password": body.password})
    if s2.status_code == 200:
        rpc("redeem_access_pin", {"_pin": str(pin)}, s2.json()["access_token"])
    return {"user": load_user(uid)}


@api.patch("/users/{uid}")
def update_user(uid: str, body: UserUpdate, user: dict = Depends(get_current_user)):
    require_roles(user, ["admin"])
    data = body.model_dump(exclude_unset=True)
    tk = user["_token"]
    result = {}
    if data.get("active") is False:
        require_pin(data.get("pin"), user)
        if uid == user["id"]:
            raise HTTPException(status_code=400, detail="Você não pode desativar sua própria conta.")
        rpc("ban_employee_with_pin", {"_employee": uid}, tk)
    if data.get("active") is True:
        result["reactivation_pin"] = rpc("issue_employee_reactivation_pin", {"_employee": uid}, tk)
    if data.get("approved") is True:
        result["access_pin"] = rpc("create_access_pin", {"_label": f"Aprovação {uid[:8]}"}, tk)
    prof = {}
    if "name" in data:
        prof["full_name"] = data["name"]
    if "phone" in data:
        prof["phone"] = data["phone"]
    if "department_id" in data:
        prof["department_id"] = data["department_id"] or None
    if prof:
        prof["updated_at"] = datetime.now(timezone.utc).isoformat()
        sb("PATCH", "profiles", {"id": f"eq.{uid}"}, prof)
    if data.get("position_id"):
        rpc("set_member_position", {"_member": uid, "_position": data["position_id"]}, tk)
    if data.get("role"):
        set_role(uid, data["role"])
    if data.get("password"):
        if len(data["password"]) < 6:
            raise HTTPException(status_code=400, detail="A senha deve ter ao menos 6 caracteres.")
        if sb_auth("PUT", f"admin/users/{uid}", {"password": data["password"]}).status_code >= 400:
            raise HTTPException(status_code=400, detail="Não foi possível alterar a senha.")
    u = load_user(uid)
    if not u:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    return {"user": u, **result}


@api.post("/auth/reactivation-pin")
def redeem_reactivation(body: PinIn, user: dict = Depends(session_user)):
    if not rpc("redeem_employee_reactivation_pin", {"_pin": body.pin.strip()}, user["_token"]):
        raise HTTPException(status_code=400, detail="PIN de reativação inválido.")
    return {"user": public(load_user(user["id"]))}


# ----------------- DAVs -----------------
def names_map():
    return {p["id"]: p.get("full_name") or p.get("email")
            for p in sb("GET", "profiles", {"select": "id,full_name,email"})}


def with_seller(rows):
    nm = names_map()
    for d in rows:
        d["seller_name"] = nm.get(d.get("seller_id"))
    return rows


def get_dav(did: str) -> dict:
    rows = sb("GET", "davs", {"id": f"eq.{did}", "select": "*"})
    if not rows:
        raise HTTPException(status_code=404, detail="DAV não encontrado.")
    return rows[0]


@api.get("/davs")
def list_davs(user: dict = Depends(get_current_user), status: Optional[str] = None,
              category: Optional[str] = None, seller_id: Optional[str] = None, q: Optional[str] = Query(None)):
    params = {"select": "*", "order": "created_at.desc"}
    if not user["is_manager"] and not user["can_stock"]:
        params["seller_id"] = f"eq.{user['id']}"
    elif seller_id:
        params["seller_id"] = f"eq.{seller_id}"
    if status:
        params["status"] = f"eq.{status}"
    if category:
        params["category"] = f"eq.{category}"
    if q:
        safe = q.replace(",", " ").replace("(", " ").replace(")", " ")
        params["or"] = f"(dav_number.ilike.*{safe}*,client_name.ilike.*{safe}*)"
    return {"davs": with_seller(sb("GET", "davs", params))}


@api.post("/davs")
def create_dav(body: DavIn, user: dict = Depends(get_current_user)):
    if body.status not in DAV_STATUS:
        raise HTTPException(status_code=400, detail="Situação inválida.")
    can_others = user["is_manager"] or user["can_stock"]
    seller_id = (body.seller_id if can_others else None) or user["id"]
    if sb("GET", "davs", {"dav_number": f"eq.{body.dav_number}", "seller_id": f"eq.{seller_id}", "select": "id"}):
        raise HTTPException(status_code=409, detail="Já existe um DAV com este número para este vendedor.")
    row = sb("POST", "davs", json={
        "dav_number": body.dav_number, "client_name": body.client_name, "description": body.description,
        "seller_id": seller_id, "due_at": body.due_at or None, "status": body.status,
        "category": body.category, "dav_value": body.dav_value, "created_by": user["id"],
    }, prefer="return=representation", token=user["_token"])
    if not row:
        raise HTTPException(status_code=403, detail="Operação não permitida para o seu perfil.")
    return {"dav": with_seller(row)[0]}


@api.patch("/davs/{did}")
def update_dav(did: str, body: DavUpdate, user: dict = Depends(get_current_user)):
    dav = get_dav(did)
    if not (user["is_manager"] or user["can_stock"]) and dav["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Você só pode alterar seus próprios DAVs.")
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in DAV_STATUS:
        raise HTTPException(status_code=400, detail="Situação inválida.")
    if "due_at" in data:
        data["due_at"] = data["due_at"] or None
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    row = sb("PATCH", "davs", {"id": f"eq.{did}"}, data, prefer="return=representation", token=user["_token"])
    if not row:
        raise HTTPException(status_code=403, detail="Operação não permitida para o seu perfil.")
    return {"dav": with_seller(row)[0]}


@api.delete("/davs/{did}")
def delete_dav(did: str, pin: Optional[str] = None, user: dict = Depends(get_current_user)):
    require_roles(user, ["admin"])
    require_pin(pin, user)
    get_dav(did)
    if not sb("DELETE", "davs", {"id": f"eq.{did}"}, prefer="return=representation", token=user["_token"]):
        raise HTTPException(status_code=403, detail="Operação não permitida para o seu perfil.")
    return {"ok": True}


# ----------------- Estoque (lembretes) -----------------
def require_stock(user):
    if not user["can_stock"]:
        raise HTTPException(status_code=403, detail="Você não tem permissão para esta ação.")


@api.get("/estoque")
def list_stock(user: dict = Depends(get_current_user), pendente: Optional[bool] = None):
    require_stock(user)
    params = {"select": "*", "order": "due_at.asc.nullslast,created_at.desc"}
    if pendente is True:
        params["completed_at"] = "is.null"
    elif pendente is False:
        params["completed_at"] = "not.is.null"
    rows = sb("GET", "stock_reminders", params)
    nm = names_map()
    for r in rows:
        r["created_by_name"] = nm.get(r.get("created_by"))
    return {"lembretes": rows}


@api.post("/estoque")
def create_stock(body: StockIn, user: dict = Depends(get_current_user)):
    require_stock(user)
    row = sb("POST", "stock_reminders", json={"title": body.title, "notes": body.notes,
                                               "due_at": body.due_at or None, "created_by": user["id"]},
             prefer="return=representation", token=user["_token"])
    if not row:
        raise HTTPException(status_code=403, detail="Operação não permitida para o seu perfil.")
    return {"lembrete": row[0]}


@api.patch("/estoque/{sid}")
def update_stock(sid: str, body: StockUpdate, user: dict = Depends(get_current_user)):
    require_stock(user)
    data = body.model_dump(exclude_unset=True)
    patch = {k: data[k] for k in ("title", "notes") if k in data}
    if "due_at" in data:
        patch["due_at"] = data["due_at"] or None
    if "completed" in data:
        patch["completed_at"] = datetime.now(timezone.utc).isoformat() if data["completed"] else None
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    row = sb("PATCH", "stock_reminders", {"id": f"eq.{sid}"}, patch, prefer="return=representation", token=user["_token"])
    if not row:
        raise HTTPException(status_code=404, detail="Lembrete não encontrado.")
    return {"lembrete": row[0]}


# ----------------- Comunicados -----------------
@api.get("/comunicados")
def list_announcements(user: dict = Depends(get_current_user)):
    rows = sb("GET", "announcements", {"select": "*", "order": "created_at.desc", "limit": "50"})
    nm = names_map()
    for r in rows:
        r["author_name"] = nm.get(r.get("author_id"))
    week = datetime.now(timezone.utc) - timedelta(days=7)
    recentes = sum(1 for r in rows if datetime.fromisoformat(r["created_at"]) > week)
    return {"comunicados": rows, "recentes": recentes}


@api.post("/comunicados")
def create_announcement(body: AnnouncementIn, user: dict = Depends(get_current_user)):
    require_roles(user, MANAGEMENT)
    row = sb("POST", "announcements", json={"title": body.title, "body": body.body,
                                             "important": body.important, "author_id": user["id"]},
             prefer="return=representation", token=user["_token"])
    if not row:
        raise HTTPException(status_code=403, detail="Operação não permitida para o seu perfil.")
    return {"comunicado": row[0]}


# ----------------- Dashboard -----------------
@api.get("/dashboard")
def dashboard(user: dict = Depends(get_current_user)):
    params = {"select": "status,dav_value"}
    if not user["is_manager"] and not user["can_stock"]:
        params["seller_id"] = f"eq.{user['id']}"
    davs = sb("GET", "davs", params)
    by = {s: 0 for s in DAV_STATUS}
    total = 0.0
    for d in davs:
        by[d["status"]] = by.get(d["status"], 0) + 1
        if d["status"] == "concluido":
            total += float(d.get("dav_value") or 0)
    stats = {"total_davs": len(davs), **by, "valor_concluido": total}
    if user["can_stock"]:
        stats["estoque_pendentes"] = len(sb("GET", "stock_reminders", {"select": "id", "completed_at": "is.null"}))
    if user["is_manager"]:
        stats["funcionarios"] = len(sb("GET", "profiles", {"select": "id", "active": "eq.true"}))
    return {"stats": stats}


# ----------------- AI -----------------
@api.post("/ai/chat")
async def ai_chat(body: AiIn, user: dict = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    system = ("Você é o assistente do sistema Shopping Hospitalar, plataforma de gestão empresarial "
              "(vendas, DAVs, estoque, funcionários). Responda em português do Brasil, objetivo e profissional. "
              f"Usuário atual: {user['name']}, cargo {user['role']}.")
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"sh-{user['id']}",
                   system_message=system).with_model("openai", "gpt-5.4")
    try:
        reply = await chat.send_message(UserMessage(text=body.message))
    except Exception as e:
        logger.error(f"AI erro: {e}")
        raise HTTPException(status_code=502, detail="Não foi possível obter resposta da IA no momento.")
    return {"reply": reply}


# Register communication endpoints before mounting the API router.
import comunicacao  # noqa: F401

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
