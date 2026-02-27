import { defineConfig } from "./src/config/types.js";
import { fsStorage } from "./src/storage/providers/fs.js";
import { noAuth } from "./src/auth/no-auth.js";
import { memoryPlugin } from "./src/plugins/memory/index.js";
import { workspacePlugin } from "./src/plugins/workspace/index.js";

export default defineConfig({
  name: "sweny-agent",
  auth: noAuth(),
  storage: fsStorage({ baseDir: "./.sweny-data" }),
  plugins: [memoryPlugin(), workspacePlugin()],
  model: {
    maxTurns: 20,
  },
});
