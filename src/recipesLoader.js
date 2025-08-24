// src/recipesLoader.js
import { Asset } from "expo-asset";
import Papa from "papaparse";
import { IMAGE_MAP } from "./imageMap";

// Normalizes one row into an app-friendly object
function normalizeRow(row, idx) {
  const title = (row.Title || `Recipe ${idx + 1}`).trim();
  const imageName = (row.Image_Name || "").trim();
  const ingredientsRaw = row.Ingredients || "";
  const instructionsRaw = row.Instructions || "";
  const cleaned = (row.Cleaned_Ingredients || "").toLowerCase();

  // Ingredients can be a JSON-like list string or a CSV string
  let ingredients = [];
  try {
    if (ingredientsRaw.trim().startsWith("[")) {
      ingredients = JSON.parse(
        ingredientsRaw.replace(/“|”/g, '"').replace(/'/g, '"')
      );
    } else {
      ingredients = ingredientsRaw.split(",").map(s => s.trim()).filter(Boolean);
    }
  } catch {
    ingredients = ingredientsRaw.split(",").map(s => s.trim()).filter(Boolean);
  }

  const instructions = instructionsRaw
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  return {
    id: String(idx), // stable local ID
    title,
    ingredients,
    instructions,
    imageName,
    imageSource: IMAGE_MAP[imageName], // may be undefined if not listed in imageMap.js
    cleanedIngredientsText: cleaned,
  };
}

export async function loadLocalRecipes() {
  // If you place it at assets/recipe.csv:
  const csvAsset = Asset.fromModule(require("../assets/recipe.csv"));
  await csvAsset.downloadAsync();
  const res = await fetch(csvAsset.localUri || csvAsset.uri);
  const text = await res.text();

  const parsed = Papa.parse(text, { header: true });
  const rows = parsed.data.filter(Boolean);

  return rows.map(normalizeRow);
}
