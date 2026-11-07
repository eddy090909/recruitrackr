import { Suspense } from "react";
import { dismissReview, resolveReview } from "@/app/actions";
import { listReview } from "@/lib/queries";
import { CATEGORIES, type Classification } from "@/lib/classify";
import { fmtDate } from "@/components/ui";

const LABEL: Record<string, string> = {
  confirmation: "Application received → Applied",
  oa: "Online assessment → OA",
  interview: "Interview",
  rejection: "Rejection",
  offer: "Offer",
  action_required: "Action required",
  update_other: "Other update",
  not_recruiting: "Not recruiting (ignore)",
};

async function ReviewList() {
  const emails = await listReview();
  if (!emails.length)
    return <p className="card px-4 py-10 text-center text-sm text-stone-500">All caught up. Nothing needs review.</p>;
  return (
    <ul className="space-y-3">
      {emails.map((e) => {
        const c: Partial<Classification> = e.extracted ? JSON.parse(e.extracted) : {};
        return (
          <li key={e.id} className="card px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <a href={`https://mail.google.com/mail/u/0/#all/${e.gmail_id}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {e.subject || "(no subject)"}
              </a>
              <span className="text-xs text-stone-500">{fmtDate(e.date, true)}</span>
            </div>
            <div className="text-xs text-stone-500">{e.sender}</div>
            <p className="mt-2 text-sm text-stone-600">{e.snippet}</p>
            <p className="mt-2 text-xs text-stone-500">
              Classifier guessed <b>{LABEL[e.category] ?? e.category}</b> · {c.company ?? "unknown company"} · confidence {Math.round((e.confidence ?? 0) * 100)}%
            </p>
            <form action={resolveReview} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={e.id} />
              <select name="category" defaultValue={e.category} className="input">
                {CATEGORIES.map((k) => (
                  <option key={k} value={k}>
                    {LABEL[k]}
                  </option>
                ))}
              </select>
              <input name="company" defaultValue={c.company ?? ""} placeholder="Company" className="input w-40" />
              <input name="role" defaultValue={c.role ?? ""} placeholder="Role" className="input w-64" />
              <button className="btn-primary">Confirm</button>
            </form>
            <form action={dismissReview} className="mt-2">
              <input type="hidden" name="id" value={e.id} />
              <button className="text-xs text-stone-500 hover:text-stone-900">Dismiss</button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}

export default function ReviewPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
        <p className="text-sm text-stone-600">Emails the classifier wasn&apos;t sure about. Confirm or correct them and they&apos;ll be applied to your pipeline.</p>
      </div>
      <Suspense fallback={<div className="card h-64 animate-pulse bg-stone-100" />}>
        <ReviewList />
      </Suspense>
    </div>
  );
}
