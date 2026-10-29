import { defineConfig } from "@rsbuild/core";
import { readAuthoredConfigInput } from "everything-dev/config";
import { createCoreUiRsbuildConfig } from "every-plugin/build/ui";

export default defineConfig(async () =>
  createCoreUiRsbuildConfig(await readAuthoredConfigInput()),
);
