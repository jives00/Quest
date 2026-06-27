const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force all React resolutions to the mobile app's node_modules to prevent
// duplicate React instances across the monorepo (pnpm hoisting creates two copies).
const PINNED = ["react", "react-native", "react-native/"];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shouldPin = PINNED.some(
    (p) => moduleName === p || moduleName.startsWith(p)
  );
  if (shouldPin) {
    return context.resolveRequest(
      { ...context, originModulePath: path.resolve(projectRoot, "index.ts") },
      moduleName,
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
