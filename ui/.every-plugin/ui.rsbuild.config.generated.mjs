import { defineConfig } from "@rsbuild/core";
import { createCoreUiRsbuildConfig } from "every-plugin/build/ui";
import { readAuthoredConfigInput } from "everything-dev/config";

export default defineConfig(async () => createCoreUiRsbuildConfig(await readAuthoredConfigInput()));
