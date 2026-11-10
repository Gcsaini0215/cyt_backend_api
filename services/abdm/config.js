// ABDM (Ayushman Bharat Digital Mission) settings — all from .env, nothing hard-wired to one environment.
//
//   ABDM_ENV            sandbox | production            (default: sandbox)
//   ABDM_CLIENT_ID      SBX_xxxxxx from NHA (sandbox) / the live client id after go-live
//   ABDM_CLIENT_SECRET  from the same NHA email — never commit it
//   ABDM_GATEWAY_URL    optional override of the gateway base (sessions, HIE-CM)
//   ABDM_ABHA_URL       optional override of the ABHA v3 base
//
// Defaults follow the ABDM V3 documentation (sandbox: dev.abdm.gov.in + abhasbx.abdm.gov.in, X-CM-ID "sbx").
// Check them again against https://sandbox.abdm.gov.in/sandbox/v3/new-documentation when the keys arrive.

const ENVS = {
  sandbox: {
    gateway: "https://dev.abdm.gov.in/api/hiecm/gateway/v3",
    abha: "https://abhasbx.abdm.gov.in/abha/api/v3",
    cmId: "sbx",
  },
  production: {
    gateway: "https://live.abdm.gov.in/api/hiecm/gateway/v3",
    abha: "https://abha.abdm.gov.in/abha/api/v3",
    cmId: "abdm",
  },
};

export function abdmConfig() {
  const env = process.env.ABDM_ENV === "production" ? "production" : "sandbox";
  const base = ENVS[env];
  return {
    env,
    clientId: process.env.ABDM_CLIENT_ID || "",
    clientSecret: process.env.ABDM_CLIENT_SECRET || "",
    gateway: (process.env.ABDM_GATEWAY_URL || base.gateway).replace(/\/+$/, ""),
    abha: (process.env.ABDM_ABHA_URL || base.abha).replace(/\/+$/, ""),
    cmId: base.cmId,
  };
}

// true only when both keys are set — until then every ABHA endpoint answers "not configured"
export const abdmConfigured = () => {
  const c = abdmConfig();
  return Boolean(c.clientId && c.clientSecret);
};
