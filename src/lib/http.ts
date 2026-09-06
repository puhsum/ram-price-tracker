// Small helper so every route returns errors in the same shape:
// { "error": "message" }. A REST API that sometimes returns a string,
// sometimes an object, sometimes HTML is annoying to consume -- pick one
// error shape and use it everywhere.
export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
