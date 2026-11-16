import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "CRM — Consultoria Reginaldo", description: "Jornada dos leads do agente SDR" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
