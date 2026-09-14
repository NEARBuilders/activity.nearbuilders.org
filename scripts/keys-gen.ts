import { randomBytes } from "node:crypto";

const lines = process.argv.slice(2);
const versionArg = lines.find((line) => line.startsWith("--version="));
const version = versionArg ? versionArg.slice("--version=".length) : "v1";
if (!/^[A-Za-z0-9_-]+$/.test(version)) {
  console.error(`Invalid --version "${version}". Use letters, digits, underscore, or hyphen.`);
  process.exit(1);
}

const key = randomBytes(32);
const encoded = key.toString("base64");
const keyring = JSON.stringify({ [version]: encoded });

console.log(`# Generated Activity signing master key (${version})`);
console.log(`# Treat the key below as a secret. It is printed once and never stored by this tool.`);
console.log(
  `# Store in your secret manager and set ACTIVITY_SIGNING_MASTER_KEYS exactly as shown.`,
);
console.log(`ACTIVITY_SIGNING_MASTER_KEYS=${keyring}`);
console.log(`ACTIVITY_SIGNING_ACTIVE_KEY_VERSION=${version}`);
console.log("");
console.log(`# Recovery: losing the key above renders any Signing Identity encrypted`);
console.log(`# under "${version}" unrecoverable. Back up the keyring before first use.`);
