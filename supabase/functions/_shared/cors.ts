// The app is native, so it needs no CORS. These headers exist for the dashboard's "Test" button and for curl from a
// browser. Every request still has to carry a verified Clerk token, so a wildcard origin lets nobody in.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
