import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { getConnection } from "@/lib/queries";
import { currentUser, isDemo } from "@/lib/auth";
import { signOut } from "./actions";
import { SyncButton } from "@/components/SyncButton";
import { fmtDate } from "@/components/ui";

export const metadata: Metadata = {
  title: "Recruitrackr",
  description: "Your recruiting pipeline, built from your inbox.",
};

async function HeaderStatus() {
  if (!(await currentUser())) return null;
  const c = await getConnection();
  if (isDemo())
    return (
      <span className="chip">Demo · sample data</span>
    );
  return (
    <div className="flex min-w-0 items-center gap-4">
      <Link href="/review" className="shrink-0 whitespace-nowrap text-sm font-medium text-neutral-600 hover:text-black">
        Review
        {c.reviewCount > 0 && (
          <span className="ml-1.5 rounded-full bg-black px-1.5 py-0.5 text-[10px] font-semibold text-white">{c.reviewCount}</span>
        )}
      </Link>
      {c.connected ? (
        <>
          <span
            className="hidden min-w-0 truncate text-xs text-neutral-500 md:inline"
            title={`${c.email} · last sync ${c.lastSyncAt ? fmtDate(c.lastSyncAt, true) : "never"}${c.llm ? "" : " · rules classifier"}`}
          >
            {c.email} · last sync {c.lastSyncAt ? fmtDate(c.lastSyncAt, true) : "never"}
            {!c.llm && " · rules classifier"}
          </span>
          <SyncButton />
        </>
      ) : (
        <a href="/api/auth/google" className="btn-primary shrink-0 whitespace-nowrap">
          Reconnect Gmail
        </a>
      )}
      <form action={signOut} className="shrink-0">
        <button className="whitespace-nowrap text-xs text-neutral-500 hover:text-black">Sign out</button>
      </form>
    </div>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <header className="sticky top-0 z-10 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
            <Link href="/" className="shrink-0 text-lg font-bold tracking-tight">
              Recruitrackr
            </Link>
            <Suspense fallback={<span className="text-xs text-neutral-400">…</span>}>
              <HeaderStatus />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 pb-16 pt-6">{children}</main>
      </body>
    </html>
  );
}
