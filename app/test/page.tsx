async function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default async function TestPage() {
  await wait(3500);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-(--bg-gradient) px-6 text-(--ink)">
      <div className="w-full max-w-2xl border-2 border-(--border) bg-(--paper) px-8 py-10 shadow-[8px_8px_0_rgba(var(--shadow-ink),0.16)]">
        <p className="heading-serif text-sm tracking-widest text-(--ink-soft)">
          Test Route
        </p>
        <h1 className="mt-3 heading-serif text-3xl">Server Loading Demo</h1>
        <p className="mt-4 text-sm text-(--ink-muted)">
          This page waits on the server before rendering so you can preview how
          route-level <code>loading.tsx</code> behaves for slow initial data
          fetches.
        </p>
      </div>
    </main>
  );
}
