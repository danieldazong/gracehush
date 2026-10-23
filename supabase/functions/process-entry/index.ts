import { handle } from "./handler.ts";

// The flow is in handler.ts, so the tests can call it without starting a server.
Deno.serve(handle);
