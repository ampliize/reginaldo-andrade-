"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const NAV = [
  { href: "/", label: "Painel" },
  { href: "/leads", label: "Leads" },
  { href: "/transbordos", label: "Transbordos", badge: true },
  { href: "/agenda", label: "Agenda" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [open, setOpen] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [session, router]);

  useEffect(() => {
    if (!session) return;
    const load = () =>
      supabase.from("handoffs").select("id", { count: "exact", head: true }).eq("status", "aberto")
        .then(({ count }) => setOpen(count ?? 0));
    load();
    const ch = supabase.channel("shell-handoffs")
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session]);

  if (!session) return <div className="login muted">Carregando…</div>;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Consultoria Reginaldo<small>CRM do atendimento</small></div>
        <nav className="nav">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={active ? "active" : ""}>
                {n.label}
                {n.badge && open > 0 && <span className="badge warn">{open}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="spacer" />
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sair</button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
