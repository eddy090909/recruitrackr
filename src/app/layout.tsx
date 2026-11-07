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
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">Demo mode · sample data</span>
    );
  return (
    <div className="flex items-center gap-4">
      <Link href="/review" className="text-sm text-stone-600 hover:text-stone-900">
        Review
        {c.reviewCount > 0 && (
          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{c.reviewCount}</span>
        )}
      </Link>
      {c.connected ? (
        <>
          <span className="hidden text-xs text-stone-500 md:inline">
            {c.email} · last sync {c.lastSyncAt ? fmtDate(c.lastSyncAt, true) : "never"}
            {!c.llm && " · rules classifier"}
          </span>
          <SyncButton />
        </>
      ) : (
        <a href="/api/auth/google" className="btn-primary">
          Reconnect Gmail
        </a>
      )}
      <form action={signOut}>
        <button className="text-xs text-stone-500 hover:text-stone-900">Sign out</button>
      </form>
    </div>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="text-base font-semibold tracking-tight">
              Recruitrackr
            </Link>
            <Suspense fallback={<span className="text-xs text-stone-400">…</span>}>
              <HeaderStatus />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
