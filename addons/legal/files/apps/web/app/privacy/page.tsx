import { PRIVACY_VERSION } from "@app-boilerplate/validation";

import { LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Privacy Policy", description: "What App Boilerplate stores about you, why, for how long, and your choices." };

// Privacy Policy (/docs/features/legal-gate.md AC9). Generic draft wording, built from
// /docs/data-inventory.md, for a lawyer to replace. `privacy-coverage.test.ts` fails when a table that
// holds personal data has no line here. Change PRIVACY_VERSION whenever this wording changes.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" version={PRIVACY_VERSION} testId="privacy">
      <section>
        <h2>1. What we store</h2>
        <ul>
          <li>Your account: name and email address, held by our sign-in provider.</li>
          <li>Your acceptance of these terms: the version, the minimum age you confirmed, and the time.</li>
          <li>Counts of your recent requests for a few actions, to stop abuse; kept at most a day.</li>
          {/* addons: privacy items */}
        </ul>
      </section>
      <section>
        <h2>2. Why</h2>
        <p>To give you the service you chose, keep the records the law requires, and keep the service secure.</p>
      </section>
      <section>
        <h2>3. Who processes it for us</h2>
        <p>Our hosting provider, our database provider and our sign-in provider, each only to run the service.</p>
      </section>
      <section>
        <h2>4. How long</h2>
        <ul>
          <li>Your account data: until you delete it or your account.</li>
          <li>Records the law requires us to keep: as long as the law requires, without your name once your account is deleted.</li>
        </ul>
      </section>
      <section>
        <h2>5. Your choices</h2>
        <ul>
          <li>Download everything held about you, as one file, from your dashboard.</li>
          <li>Delete your account from your dashboard. Your data is deleted, and records the law requires are kept without your name.</li>
        </ul>
      </section>
      <section>
        <h2>6. Children</h2>
        <p>App Boilerplate is not for children under the minimum age shown in the Terms of Service.</p>
      </section>
      <section>
        <h2>7. Contact</h2>
        <p>Contact address: to be added before launch.</p>
      </section>
    </LegalPage>
  );
}
