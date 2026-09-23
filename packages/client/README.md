# @nearbuilders/activity-client

Typed oRPC client for the [NEAR Builders Activity](https://activity.nearbuilders.org) API.

```ts
import { createActivityClient } from "@nearbuilders/activity-client";

const activity = createActivityClient("https://activity.nearbuilders.org");
const feed = await activity.listActivityEvents({ limit: 5 });
```

Pass a Source API Key from server-side code when calling protected ingestion routes:

```ts
const activity = createActivityClient("https://activity.nearbuilders.org", {
  apiKey: process.env.ACTIVITY_API_KEY,
});
```

The client sends the key as `Authorization: Bearer ...` and includes browser session cookies. The
package also exports `contract` and `ContractType` for tools that work directly with the oRPC
contract. See the [integration guide](https://github.com/NEARBuilders/activity.nearbuilders.org/blob/main/docs/integration-guide.md)
for source registration and API examples.
