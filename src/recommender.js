// src/recommender.js
export function keywordsFromWeather(tempC, conditionMain) {
    if (tempC <= 10) return ["soup", "stew", "haleem", "baked", "roast"];
    if (tempC <= 20) {
      return conditionMain === "Rain"
        ? ["curry", "noodle", "ramen", "stir fry"]
        : ["pasta", "mac and cheese", "risotto"];
    }
    if (conditionMain === "Rain") return ["noodle", "pho", "soup"];
    if (conditionMain === "Clear") return ["salad", "ceviche", "cold", "dip"];
    return ["stir fry", "grill", "roast"];
  }
  
  export function filterByKeyword(recipes, keyword) {
    const kw = keyword.toLowerCase();
    return recipes.filter(r =>
      r.title.toLowerCase().includes(kw) ||
      r.cleanedIngredientsText?.includes(kw)
    );
  }
  
  export function candidatesFromWeather(recipes, tempC, conditionMain) {
    const buckets = keywordsFromWeather(tempC, conditionMain);
    for (const kw of buckets) {
      const matches = filterByKeyword(recipes, kw);
      if (matches.length) return matches;
    }
    return recipes; // fallback
  }
  
  export function pickRecipe(candidates, excludeIds = new Set()) {
    const pool = candidates.filter(r => !excludeIds.has(r.id));
    const list = pool.length ? pool : candidates;
    return list[Math.floor(Math.random() * list.length)];
  }
  