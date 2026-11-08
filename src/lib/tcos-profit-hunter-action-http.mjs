import { ZodError } from "zod";
import { validateProfitHunterServiceBearer } from "./tcos-profit-hunter-policy";

export function noStoreJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function authorizeProfitHunterAction(request) {
  if (validateProfitHunterServiceBearer(request.headers.get("authorization"))) {
    return null;
  }

  return Response.json(
    { error: "Unauthorized", code: "TCOS_PROFIT_HUNTER_UNAUTHORIZED" },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "WWW-Authenticate": "Bearer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function readJsonObject(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new ActionRequestError(415, "Content-Type must be application/json.");
  }

  let value;
  try {
    value = await request.json();
  } catch {
    throw new ActionRequestError(400, "Request body must contain valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ActionRequestError(400, "Request body must be a JSON object.");
  }
  return value;
}

export class ActionRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ActionRequestError";
    this.status = status;
  }
}

export function actionErrorResponse(error) {
  if (error instanceof ActionRequestError) {
    return noStoreJson({ error: error.message, code: "INVALID_ACTION_REQUEST" }, error.status);
  }

  if (error instanceof ZodError) {
    return noStoreJson(
      {
        error: "Request failed validation.",
        code: "ACTION_VALIDATION_FAILED",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("TCOS Profit Hunter Action failed:", message);
  return noStoreJson(
    {
      error: message,
      code: "TCOS_PROFIT_HUNTER_ACTION_FAILED",
    },
    500,
  );
}
