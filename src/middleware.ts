export { proxy as middleware } from "./request-gate";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
