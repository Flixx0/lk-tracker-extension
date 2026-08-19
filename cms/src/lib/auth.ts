const COOKIE = "lk_cms_session";

function secret() {
  return process.env.CMS_PASSWORD ?? "";
}

export function authEnabled(): boolean {
  return secret().length > 0;
}

export async function sessionToken(): Promise<string> {
  const password = secret();
  const data = new TextEncoder().encode(`lk-tracker-cms:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isValidPassword(password: string): boolean {
  return authEnabled() && password === secret();
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true;
  if (!token) return false;
  return token === (await sessionToken());
}

export { COOKIE as SESSION_COOKIE };
