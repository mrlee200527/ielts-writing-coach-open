export type MiMoConfig = Readonly<{
  apiKey: string;
  baseUrl: string;
  model: string;
}>;

type MiMoEnvironment = Readonly<{
  MIMO_API_KEY?: string;
  MIMO_BASE_URL?: string;
  MIMO_MODEL?: string;
  [name: string]: string | undefined;
}>;

export function loadMiMoConfig(env: MiMoEnvironment = process.env): MiMoConfig {
  const apiKey = env.MIMO_API_KEY?.trim();
  const configuredBaseUrl = env.MIMO_BASE_URL?.trim();
  const model = env.MIMO_MODEL?.trim();
  if (!apiKey || !configuredBaseUrl || !model) throw new Error("MIMO_CONFIGURATION_MISSING");

  let url: URL;
  try {
    url = new URL(configuredBaseUrl);
  } catch {
    throw new Error("MIMO_CONFIGURATION_INVALID");
  }

  const isLocalHttp = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !isLocalHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("MIMO_CONFIGURATION_INVALID");
  }

  return Object.freeze({ apiKey, baseUrl: configuredBaseUrl.replace(/\/+$/, ""), model });
}
