import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  if (command === "build" && mode === "online") {
    const env = loadEnv(mode, process.cwd(), "VITE_SUPABASE_");
    if (
      !/^https:\/\/[^/]+\.supabase\.co\/?$/.test(env.VITE_SUPABASE_URL || "") ||
      !env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")
    ) {
      throw new Error("オンライン公開にはSupabase URLとsb_publishable_形式の公開キーを設定してください。秘密キーは使用できません。");
    }
  }
  return {};
});
