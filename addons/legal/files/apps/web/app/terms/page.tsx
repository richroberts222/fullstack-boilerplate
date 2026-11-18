import { MINIMUM_AGE, TERMS_VERSION } from "@app-boilerplate/validation";
import Link from "next/link";

import { LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Terms of Service", description: "The terms for using App Boilerplate." };

// Terms of Service (/docs/features/legal-gate.md AC9). Generic draft wording for a lawyer to replace.
// Change TERMS_VERSION whenever this wording changes, so every member is asked again.
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" version={TERMS_VERSION} testId="terms">
      <section>
        <h2>1. Who may use App Boilerplate</h2>
        <p>You must be at least {MINIMUM_AGE} years old to create an account. By creating an account you confirm that you are, and that the details you give are true.</p>
      </section>
      <section>
        <h2>2. Your account</h2>
        <p>Keep your sign-in details private. You are responsible for what happens under your account. You may delete your account at any time from your dashboard.</p>
      </section>
      {/* addons: terms sections */}
      <section>
        <h2>3. Using the service</h2>
        <p>Use the service lawfully and only for your own purposes. Do not copy, resell or publish what it provides. Your access may be ended if you do.</p>
      </section>
      <section>
        <h2>4. No guarantees, and limits</h2>
        <p>The service is offered as it is. To the extent the law allows, App Boilerplate is not liable for indirect losses, and its total liability is limited to what you paid in the last twelve months.</p>
      </section>
      <section>
        <h2>5. Changes</h2>
        <p>If these terms change, you will be asked to accept the new version before you continue.</p>
      </section>
      <section>
        <h2>6. Privacy and contact</h2>
        <p>
          How your information is handled is in the{" "}
          <Link href="/privacy" className="text-primary underline-offset-4 hover:underline" data-testid="terms-privacy-link">
            Privacy Policy
          </Link>
          . Contact address and governing law: to be added before launch.
        </p>
      </section>
    </LegalPage>
  );
}
