import type { NextConfig } from "next";

// Baseline response headers (docs/secure-coding.md). Anti-framing blocks clickjacking (cross-frame
// attacks); nosniff, referrer and permissions policies limit leakage and browser features. A full
// script policy (CSP script-src and friends) is staged separately: the identity provider's scripts
// need an allow-list and a nonce setup, so it is introduced in report-only mode first.
// Browser features (camera, microphone, geolocation, payment) are denied by default; the feature that
// needs one allows it for this origin in the same pull request.
export const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  /* config options here */
  agentRules: false,
  transpilePackages: ["@app-boilerplate/shared", "@app-boilerplate/validation"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
