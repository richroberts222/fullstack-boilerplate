import Link from "next/link";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="bg-hero-glow border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 pt-16 pb-24 sm:px-6 sm:pt-24 sm:pb-32">
          <h1 className="font-heading max-w-3xl text-5xl leading-[1.02] font-extrabold tracking-tight sm:text-7xl">
            App Boilerplate
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground sm:text-xl">
            This is the starting page. Replace it when the first feature is specified.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Show when="signed-out">
              <SignInButton>
                <Button size="lg" className="h-11 px-5 text-base" data-testid="home-sign-in">
                  Sign in
                </Button>
              </SignInButton>
              <SignUpButton>
                <Button variant="ghost" size="lg" className="h-11 px-4 text-base" data-testid="home-sign-up">
                  Sign up
                </Button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Button size="lg" className="h-11 px-5 text-base" nativeButton={false} data-testid="home-dashboard" render={<Link href="/dashboard" data-testid="home-dashboard-link" />}>
                Go to dashboard
              </Button>
            </Show>
          </div>
        </div>
      </section>
    </main>
  );
}
