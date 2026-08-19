"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Mot de passe incorrect");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Impossible de se connecter");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-line bg-panel p-8 shadow-[0_20px_50px_-24px_rgba(28,24,20,0.35)]"
      >
        <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">LK Tracker</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Prospection</h1>
        <p className="mt-1 text-sm text-muted">Entre le mot de passe pour ouvrir le CMS.</p>
        <label className="mt-6 block text-sm font-medium" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2.5 outline-none ring-accent/30 focus:ring-4"
        />
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        <button
          type="submit"
          disabled={loading || !password}
          className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-600 disabled:opacity-50"
        >
          {loading ? "Connexion…" : "Entrer"}
        </button>
      </form>
    </main>
  );
}
