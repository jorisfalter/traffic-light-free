// Polls App Store Connect for the most recently uploaded build of the app,
// waits until it finishes processing, and attaches it to the internal beta
// group so internal testers get it automatically. Run from CI after upload.
//
// Required env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_API_KEY_P8 (raw .p8 contents).
import crypto from "node:crypto";

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER = process.env.ASC_ISSUER_ID;
const P8 = process.env.ASC_API_KEY_P8;
const BUNDLE_ID = "com.jorisfalter.lightlessbike";

if (!KEY_ID || !ISSUER || !P8) {
  console.error("Missing ASC_KEY_ID / ASC_ISSUER_ID / ASC_API_KEY_P8");
  process.exit(1);
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const input =
    b64url({ alg: "ES256", kid: KEY_ID, typ: "JWT" }) +
    "." +
    b64url({ iss: ISSUER, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
  const sig = crypto.sign("sha256", Buffer.from(input), { key: P8, dsaEncoding: "ieee-p1363" });
  return input + "." + sig.toString("base64url");
}

async function api(path, method = "GET", body) {
  const res = await fetch("https://api.appstoreconnect.apple.com" + path, {
    method,
    headers: { Authorization: "Bearer " + jwt(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const apps = await api(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
const app = apps.body?.data?.[0];
if (!app) {
  console.error("No app found for bundle id", BUNDLE_ID);
  process.exit(1);
}
console.log("App:", app.id, app.attributes.name);

const groups = await api(`/v1/betaGroups?filter[app]=${app.id}&limit=50`);
const internal = (groups.body?.data || []).find((g) => g.attributes.isInternalGroup);
if (!internal) {
  console.error("No internal beta group found. Create one once in App Store Connect.");
  process.exit(1);
}
console.log("Internal group:", internal.id, internal.attributes.name);

// The build job passes the exact CFBundleVersion it uploaded so we attach
// that build and not a stale "newest" that registers a moment later.
const EXPECTED = process.env.EXPECTED_BUILD;
let build = null;
for (let i = 0; i < 30; i += 1) {
  const r = await api(
    `/v1/builds?filter[app]=${app.id}&limit=10&sort=-uploadedDate&include=buildBetaDetail`,
  );
  const list = r.body?.data || [];
  const target = EXPECTED ? list.find((b) => b.attributes.version === EXPECTED) : list[0];
  const det = (r.body?.included || []).find(
    (x) => x.type === "buildBetaDetails" && x.id === target?.relationships?.buildBetaDetail?.data?.id,
  );
  const state = target?.attributes?.processingState;
  if (!target) {
    console.log(`[try ${i}] build ${EXPECTED} not registered yet`);
  } else {
    console.log(
      `[try ${i}] build ${target.attributes.version} proc=${state} internal=${det?.attributes?.internalBuildState}`,
    );
    if (state && state !== "PROCESSING") {
      build = target;
      break;
    }
  }
  await sleep(30000);
}

if (!build || build.attributes.processingState !== "VALID") {
  console.error("Build did not reach VALID state in time:", build?.attributes?.processingState);
  process.exit(1);
}

const attach = await api(`/v1/betaGroups/${internal.id}/relationships/builds`, "POST", {
  data: [{ type: "builds", id: build.id }],
});
console.log("Attach status:", attach.status);
if (attach.status >= 400) {
  console.error(JSON.stringify(attach.body));
  process.exit(1);
}
console.log(`Build ${build.attributes.version} is now available to internal testers.`);
