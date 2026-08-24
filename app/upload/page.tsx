import { cookies } from "next/headers";
import { UploadForm } from "@/app/upload/upload-form";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export default async function UploadPage() {
  const cookieStore = await cookies();
  const session = decodeSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Upload CSV</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {session?.email}
          </p>
        </div>
        <form method="post" action="/api/auth/logout">
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Log out
          </button>
        </form>
      </header>
      <UploadForm />
    </main>
  );
}
