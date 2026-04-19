import type { SessionUser } from "./api";

/**
 * Сохраняем только данные пользователя (имя, роль, id).
 * Токен теперь хранится в httpOnly cookie — JS к нему не имеет доступа.
 */
export function saveSession(user: SessionUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem("user", JSON.stringify(user));
}

export function getStoredUser(): SessionUser | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem("user");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

/** @deprecated Токен теперь в httpOnly cookie. Всегда возвращает null. */
export function getStoredToken(): null {
  return null;
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("user");
}
