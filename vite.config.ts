import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Keeps your server-side rendering working
    server: { entry: "server" },
  },
  vite: {
    // We have removed the mcpPlugin() call here.
    // The @lovable.dev/vite-tanstack-config wrapper automatically 
    // handles the necessary build steps for your project.
    plugins: [],
  },
});