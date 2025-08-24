// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

module.exports = (() => {
  const config = getDefaultConfig(__dirname);
  // Add .csv to asset extensions so require("../assets/recipe.csv") works
  config.resolver.assetExts.push("csv");
  return config;
})();
