import { describe, expect, it } from "vitest";

import { ForbiddenError } from "../auth/errors";
import { requireJobAuthorization, requireJobSecret } from "./secret";

const SECRET = "s".repeat(40);
const req = (auth?: string) => new Request("https://example.com/api/v1/jobs/access-notices", { headers: auth ? { authorization: auth } : {} });

describe("job secret", () => {
  it("grace AC10: the final-notice job runs only with the exact configured secret", () => {
    expect(() => requireJobSecret(req(`Bearer ${SECRET}`), SECRET)).not.toThrow();
    expect(() => requireJobSecret(req(), SECRET)).toThrow(ForbiddenError);
    expect(() => requireJobSecret(req(`Bearer ${SECRET}x`), SECRET)).toThrow(ForbiddenError);
    expect(() => requireJobSecret(req(SECRET), SECRET)).toThrow(ForbiddenError);
  });

  it("grace AC10: with no secret configured, every request is refused, even one sending an empty bearer", () => {
    expect(() => requireJobAuthorization("Bearer ", "")).toThrow(ForbiddenError);
    expect(() => requireJobAuthorization(null, "")).toThrow(ForbiddenError);
    expect(() => requireJobSecret(req(), "")).toThrow(ForbiddenError);
  });
});
