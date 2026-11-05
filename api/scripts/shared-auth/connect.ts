import pg from "pg";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(2);
  }
  return value;
}

/** Same SSL rule as the API's own pool (`src/db/index.ts`). */
export async function connect(url: string): Promise<pg.Client> {
  const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
  const client = new pg.Client({
    connectionString: url,
    ssl: isLocal
      ? false
      : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" },
  });
  await client.connect();
  return client;
}
