import { Suspense } from "react";
import { loginErrorMessage } from "@/lib/login-errors";

async function ErrorNote({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const error = loginErrorMessage((await searchParams).error);
  if (!error) return null;
  return <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
}

export default function Login({ searchParams }: PageProps<"/login">) {
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="card px-6 py-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Recruitrackr</h1>
        <p className="mt-2 text-sm text-stone-600">Your recruiting pipeline, built from your inbox.</p>
        <a href="/api/auth/google" className="btn-primary mt-6 w-full justify-center py-2">
          Sign in with Google
        </a>
        <p className="mt-3 text-xs text-stone-500">Read-only Gmail access. Only the owner&apos;s account can sign in.</p>
        <Suspense>
          <ErrorNote searchParams={searchParams as Promise<Record<string, string | undefined>>} />
        </Suspense>
      </div>
    </div>
  );
}
