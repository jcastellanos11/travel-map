// Liveness only: no database, Auth, R2 or Images readiness assertion.
export function health(): Response {
  return Response.json({ status: 'ok' });
}
