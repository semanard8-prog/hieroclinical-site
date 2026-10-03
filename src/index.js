import { handleContact } from "../functions/api/contact.js";

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/contact" || path === "/api/contact/") {
      return handleContact(request, env);
    }
    if (!env || !env.ASSETS) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
