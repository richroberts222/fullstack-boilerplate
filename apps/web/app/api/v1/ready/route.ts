import { apiRoute } from "../../../../lib/api/route";
import { readyRoutes } from "../../../../lib/api/ready";
import { getReadyService } from "../../../../lib/composition";

// Readiness for uptime monitoring: 200 when the database answers, 503 when it does not.
export const { GET } = readyRoutes(apiRoute, getReadyService).get;
