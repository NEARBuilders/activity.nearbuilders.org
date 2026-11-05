/**
 * Rspack configuration with Module Federation for the API remote.
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import { rspack } from "@rspack/core";
import { createPluginBaseConfig } from "every-plugin/build/rspack";

const baseConfig = createPluginBaseConfig({
  rspack: {
    module: {
      rules: [
        // The drizzle migrations unplugin has no loadInclude, so it forces every module to
        // "javascript/auto" — including JSON. Keep JSON as JSON so bundled deps that
        // require their package.json (e.g. redis) build. The production host doesn't ship
        // redis, so it has to be bundled rather than external.
        { test: /\.json$/i, type: "json" },
      ],
    },
  },
});

export default {
  ...baseConfig,
  plugins: [
    ...baseConfig.plugins,
    new rspack.DefinePlugin({
      "process.env.WS_NO_BUFFER_UTIL": JSON.stringify("1"),
      "process.env.WS_NO_UTF_8_VALIDATE": JSON.stringify("1"),
    }),
  ],
};
