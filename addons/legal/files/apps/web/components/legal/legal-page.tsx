import type { ReactNode } from "react";

// The frame of the Terms and Privacy pages (/docs/features/legal-gate.md): a draft notice until a
// lawyer has read the wording, the version a member accepts, and readable sections.
export function LegalPage({ title, version, children, testId }: { title: string; version: string; children: ReactNode; testId: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-8" data-testid={testId}>
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="text-sm text-muted-foreground" data-testid={`${testId}-version`}>
          Version {version}
        </p>
      </div>
      <p role="note" className="rounded-xl border border-primary/50 bg-primary/10 p-4 text-sm" data-testid={`${testId}-draft`}>
        Draft. This wording is a starting point and has not yet been reviewed by a lawyer. It will be replaced before App Boilerplate opens to the public.
      </p>
      <div className="flex flex-col gap-6 leading-relaxed [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted-foreground [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1 [&_ul]:text-muted-foreground">
        {children}
      </div>
    </main>
  );
}
