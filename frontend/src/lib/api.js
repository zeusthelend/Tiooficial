import axios from "axios";

// Vite exposes client-side environment variables through import.meta.env.
// Keep the app usable on a same-origin deployment when no backend URL is set.
const configuredBackendUrl =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL ||
  "";

const normalizedBackendUrl = configuredBackendUrl.replace(/\/+$/, "");
const apiBaseUrl = normalizedBackendUrl
  ? normalizedBackendUrl.endsWith("/api")
    ? normalizedBackendUrl
    : `${normalizedBackendUrl}/api`
  : "/api";

const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: {
    Accept: "application/json",
  },
});

export function apiError(detail) {
  if (detail == null) return "Algo deu errado. Tente novamente.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  if (detail && typeof detail.message === "string") return detail.message;
  return String(detail);
}

export default api;
