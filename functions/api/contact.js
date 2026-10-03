// POST /api/contact
// Sends one plain-text email via the Worker send_email binding named EMAIL.
// Binding docs: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
// Pages bindings do not include send_email; this Worker is what the live
// hieroclinical-site workers.dev project runs. onRequest is here so a Pages
// project can call the same handler if EMAIL is bound in the dashboard.

const TO = "hello@hieroclinical.com";
const FROM = "noreply@hieroclinical.com";

const FIELDS = ["name", "email", "role", "program", "use_case"];
const LIMITS = {
  name: 200,
  email: 320,
  role: 200,
  program: 300,
  use_case: 4000,
};
const MAX_BODY = 65536;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function bad() {
  return json({ ok: false }, 400);
}

function cleanLine(value, max) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  if (/[\u0000-\u001F\u007F]/.test(text)) return null;
  return text;
}

function cleanUseCase(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text || text.length > LIMITS.use_case) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return null;
  return text;
}

function validEmail(value) {
  if (!value || value.length > LIMITS.email) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}

export function parseSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const keys = Object.keys(input);
  if (keys.length !== FIELDS.length) return null;
  for (const key of keys) {
    if (!FIELDS.includes(key)) return null;
  }
  const name = cleanLine(input.name, LIMITS.name);
  const email = cleanLine(input.email, LIMITS.email);
  const role = cleanLine(input.role, LIMITS.role);
  const program = cleanLine(input.program, LIMITS.program);
  const useCase = cleanUseCase(input.use_case);
  if (!name || !email || !role || !program || !useCase) return null;
  if (!validEmail(email)) return null;
  return { name, email, role, program, use_case: useCase };
}

async function readFields(request) {
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_BODY) return null;
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (type.includes("application/json")) {
    try {
      return JSON.parse(new TextDecoder().decode(buf));
    } catch {
      return null;
    }
  }
  if (
    type.includes("multipart/form-data") ||
    type.includes("application/x-www-form-urlencoded")
  ) {
    try {
      const form = await new Request(request.url, {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") },
        body: buf,
      }).formData();
      const out = {};
      for (const [key, value] of form.entries()) {
        if (typeof value !== "string" || Object.prototype.hasOwnProperty.call(out, key)) return null;
        out[key] = value;
      }
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

function subjectFor(program) {
  const clean = program.replace(/\s+/g, " ").trim().slice(0, 120);
  return "Trial code request from " + clean;
}

function textBody(fields) {
  return [
    "Name: " + fields.name,
    "Work email: " + fields.email,
    "Role: " + fields.role,
    "Program or organization: " + fields.program,
    "Short use case:",
    fields.use_case,
  ].join("\n");
}

export async function handleContact(request, env) {
  if (request.method !== "POST") return json({ ok: false }, 405);
  const fields = parseSubmission(await readFields(request));
  if (!fields) return bad();
  const emailBinding = env && env.EMAIL;
  if (!emailBinding || typeof emailBinding.send !== "function") return json({ ok: false }, 500);
  try {
    await emailBinding.send({
      to: TO,
      from: FROM,
      replyTo: fields.email,
      subject: subjectFor(fields.program),
      text: textBody(fields),
    });
  } catch {
    return json({ ok: false }, 502);
  }
  return json({ ok: true }, 200);
}

export async function onRequest(context) {
  return handleContact(context.request, context.env);
}
