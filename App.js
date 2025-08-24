// App.js
import React, { useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  ScrollView,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import * as Crypto from "expo-crypto";
import { createClient } from "@supabase/supabase-js";

import { loadLocalRecipes } from "./src/recipesLoader";
import { candidatesFromWeather, pickRecipe } from "./src/recommender";

const Stack = createStackNavigator();

// ─── Storage keys ─────────────────────────────────────────────────────────────
const SAVED_KEY = "@saved_recipes";   // array of saved recipes
const USER_KEY  = "@user_profile";    // current logged-in user (no password)

// ─── Weather API (optional) ───────────────────────────────────────────────────
const OPENWEATHER_KEY = "344eeabb08b57186c7e041f2723e64ee"; // or "" to use placeholders

// ─── Supabase (cloud storage for user creds) ──────────────────────────────────
const SUPABASE_URL = "https://weqivwcbwbzlbsnqycue.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlcWl2d2Nid2J6bGJzbnF5Y3VlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNjc4NDgsImV4cCI6MjA3MTY0Mzg0OH0.I7oAA5wytOH3K-o4h9Vsf1ThR9Fs8QKMbxlghWUiwOY";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Simple deterministic hash (class demo): SHA-256("username:password")
async function hashPassword(username, password) {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${username}:${password}`
  );
}

// Helper: pick random item, optionally different from currentId
function pickRandomDifferent(list, currentId) {
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0];
  const pool = list.filter((r) => r.id !== currentId);
  const base = pool.length ? pool : list;
  return base[Math.floor(Math.random() * base.length)];
}

function HomeScreen({ navigation }) {
  const [place, setPlace] = useState(null);
  const [weatherStr, setWeatherStr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  const [candidates, setCandidates] = useState([]);
  const [recipe, setRecipe] = useState(null);
  const [fetchingMore, setFetchingMore] = useState(false);

  // Keep ALL local recipes for "random fallback"
  const allRecipesRef = useRef([]);
  // Tracks which candidate IDs we've shown during this cycle
  const usedIdsRef = useRef(new Set());

  useEffect(() => {
    (async () => {
      try {
        // 0) Load local recipes from CSV
        const local = await loadLocalRecipes();
        allRecipesRef.current = local;

        // 1) Ask location permission (with Houston fallback if denied)
        const { status } = await Location.requestForegroundPermissionsAsync();

        // Fallback defaults
        let temp = 32;
        let condition = "Clear";
        let placeStr = "Houston, USA";
        let weatherString = "32°C, sunny";

        if (status === "granted") {
          // 2) Coordinates
          const { coords } = await Location.getCurrentPositionAsync({});
          const { latitude, longitude } = coords;

          // 3) Reverse geocode for display
          const parts = await Location.reverseGeocodeAsync({ latitude, longitude });
          const p = parts?.[0];
          const cityLike = p?.city || p?.subregion || p?.region || "Unknown";
          const countryLike = p?.country || "";
          placeStr = `${cityLike}${countryLike ? `, ${countryLike}` : ""}`;

          // 4) Weather (optional)
          if (OPENWEATHER_KEY) {
            try {
              const wRes = await fetch(
                `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${OPENWEATHER_KEY}`
              );
              const wData = await wRes.json();
              if (wRes.ok) {
                temp = Math.round(wData.main.temp);
                condition = wData.weather?.[0]?.main ?? "Clear";
                const desc = wData.weather?.[0]?.description ?? "";
                weatherString = `${temp}°C, ${desc}`;
              } else {
                weatherString = "Weather unavailable";
              }
            } catch {
              weatherString = "Weather unavailable";
            }
          } else {
            // Offline theme even with real location
            temp = 30;
            condition = "Clear";
            weatherString = "30°C, clear (placeholder)";
          }
        }

        setPlace(placeStr);
        setWeatherStr(weatherString);

        // 5) Build candidates & pick a recipe
        const cands = candidatesFromWeather(local, temp, condition);
        setCandidates(cands);
        usedIdsRef.current.clear();

        let picked;
        if (cands.length > 0) {
          picked = pickRecipe(cands, usedIdsRef.current);
        } else {
          // If no candidates for this weather, show a random recipe from ALL
          picked = pickRandomDifferent(allRecipesRef.current, null);
        }
        setRecipe(picked);
        if (picked) usedIdsRef.current.add(picked.id);
      } catch (e) {
        setErrorMsg(e.message || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Guaranteed-different NEXT recipe; if none left for weather → random from ALL
  const onFindMore = () => {
    if (fetchingMore) return;
    setFetchingMore(true);
    try {
      // If there are no weather candidates at all, or only one and it’s the current one,
      // pick a random recipe from ALL local recipes.
      if (!candidates.length || (candidates.length === 1 && candidates[0].id === recipe?.id)) {
        const nextAny = pickRandomDifferent(allRecipesRef.current, recipe?.id);
        if (nextAny) {
          setRecipe(nextAny);
          // Do not track random in usedIdsRef since it's out of the weather pool
        } else {
          Alert.alert("No recipes found", "Your local recipe list seems empty.");
        }
        return;
      }

      // Build list of weather-matched candidates not shown in this cycle
      let unused = candidates.filter((r) => !usedIdsRef.current.has(r.id));

      // If exhausted, reset the cycle but avoid immediately repeating the current card
      if (unused.length === 0) {
        usedIdsRef.current.clear();
        unused = candidates.filter((r) => r.id !== recipe?.id);
      } else {
        // Also avoid repeating the current card if it slipped into `unused`
        unused = unused.filter((r) => r.id !== recipe?.id);
        if (unused.length === 0) {
          // Fallback: everything except the current one
          unused = candidates.filter((r) => r.id !== recipe?.id);
        }
      }

      // If still nothing (very small pool), fallback to ANY random
      if (unused.length === 0) {
        const nextAny = pickRandomDifferent(allRecipesRef.current, recipe?.id);
        if (nextAny) {
          setRecipe(nextAny);
        } else {
          Alert.alert("No recipes found", "Your local recipe list seems empty.");
        }
        return;
      }

      const next = unused[Math.floor(Math.random() * unused.length)];
      setRecipe(next);
      usedIdsRef.current.add(next.id);
    } catch (e) {
      Alert.alert("Oops", e.message || "Couldn't find more recipes.");
    } finally {
      setFetchingMore(false);
    }
  };

  // Saved button → require login first; after login, auto-redirect to Saved
  const onOpenSaved = async () => {
    try {
      const raw = await AsyncStorage.getItem(USER_KEY);
      const user = raw ? JSON.parse(raw) : null;
      if (user?.username) {
        // Already logged in
        navigation.navigate("Saved");
      } else {
        // Not logged in → go to Profile and tell it to redirect to Saved on success
        navigation.navigate("Profile", { redirectTo: "Saved" });
      }
    } catch {
      navigation.navigate("Profile", { redirectTo: "Saved" });
    }
  };

  const onOpenProfile = () => navigation.navigate("Profile");

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.header}>Your Location & Weather</Text>

        {loading ? (
          <ActivityIndicator size="large" />
        ) : errorMsg ? (
          <Text style={styles.error}>{errorMsg}</Text>
        ) : (
          <>
            <Text style={styles.location}>{place}</Text>
            {!!weatherStr && <Text style={styles.weather}>{weatherStr}</Text>}

            <Text style={styles.subHeader}>Recommended Dish</Text>
            {recipe && (
              <TouchableOpacity
                style={styles.card}
                onPress={() => navigation.navigate("Recipe", { recipe })}
              >
                {recipe.imageSource ? (
                  <Image source={recipe.imageSource} style={styles.image} />
                ) : null}
                <Text style={styles.cardTitle}>{recipe.title}</Text>
                <Text style={styles.cardCta}>View recipe →</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Bottom action bar: More | Saved | Profile */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.bottomBtn}
          onPress={onFindMore}
          disabled={fetchingMore || loading}
        >
          <Text style={styles.bottomBtnText}>
            {fetchingMore ? "Finding..." : "More"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomBtn, styles.bottomBtnSecondary]}
          onPress={onOpenSaved}
        >
          <Text style={[styles.bottomBtnText, styles.bottomBtnTextSecondary]}>
            Saved
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomBtn, styles.bottomBtnSecondary]}
          onPress={onOpenProfile}
        >
          <Text style={[styles.bottomBtnText, styles.bottomBtnTextSecondary]}>
            Profile
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function RecipeScreen({ route }) {
  const { recipe } = route.params; // Full local object
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    try {
      const existing = await AsyncStorage.getItem(SAVED_KEY);
      const arr = existing ? JSON.parse(existing) : [];
      const exists = arr.some((r) => r.id === recipe.id);
      if (!exists) {
        // Save full details so opening from Saved works offline
        arr.push({
          id: recipe.id,
          title: recipe.title,
          imageName: recipe.imageName,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          savedAt: Date.now(),
        });
        await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(arr));
      }
      setSaved(true);
      Alert.alert("Saved", "Recipe saved to your device.");
    } catch {
      Alert.alert("Error", "Could not save recipe.");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>{recipe.title}</Text>
      {recipe.imageSource ? (
        <Image source={recipe.imageSource} style={styles.detailImage} />
      ) : null}

      <Text style={styles.subHeader}>Ingredients</Text>
      {(recipe.ingredients ?? []).map((line, i) => (
        <Text key={i} style={styles.step}>
          • {line}
        </Text>
      ))}

      <Text style={styles.subHeader}>Steps</Text>
      {(recipe.instructions ?? []).map((s, i) => (
        <Text key={i} style={styles.step}>
          {i + 1}. {s}
        </Text>
      ))}

      <TouchableOpacity
        style={[styles.saveBtn, saved && { opacity: 0.7 }]}
        onPress={handleSave}
      >
        <Text style={styles.saveBtnText}>
          {saved ? "Recipe Saved ✓" : "Save Recipe"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SavedRecipesScreen({ navigation }) {
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const existing = await AsyncStorage.getItem(SAVED_KEY);
      const arr = existing ? JSON.parse(existing) : [];
      setSaved(arr);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsub = navigation.addListener("focus", load);
    return unsub;
  }, [navigation]);

  const resolveImage = (imageName) => {
    try {
      const { resolveImage } = require("./src/imageMap");
      return resolveImage(imageName);
    } catch {
      return undefined;
    }
  };

  const onOpen = (item) => {
    navigation.navigate("Recipe", {
      recipe: {
        id: item.id,
        title: item.title,
        imageName: item.imageName,
        imageSource: resolveImage(item.imageName),
        ingredients: item.ingredients || [],
        instructions: item.instructions || [],
      },
    });
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.savedItem} onPress={() => onOpen(item)}>
      <Text style={styles.savedName}>{item.title}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.header}>Saved</Text>
        {loading ? (
          <ActivityIndicator size="large" />
        ) : saved.length === 0 ? (
          <Text style={{ opacity: 0.7, marginTop: 8 }}>No recipes saved yet.</Text>
        ) : (
          <FlatList
            data={saved}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
          />
        )}
      </View>
    </View>
  );
}

function ProfileScreen({ navigation, route }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(null); // { username }

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(USER_KEY);
        if (raw) setCurrent(JSON.parse(raw));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Cloud helpers (Supabase)
  const getUserByName = async (username) => {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error; // no rows
    return data; // null if not found
  };

  const insertUser = async (username, password_hash) => {
    const { error } = await supabase.from("users").insert([{ username, password_hash }]);
    if (error) throw error;
  };

  const redirectIfNeeded = () => {
    const target = route?.params?.redirectTo;
    if (target) {
      // Clear the param so we don't loop if user backs to Profile again
      navigation.setParams({ redirectTo: undefined });
      navigation.navigate(target);
    }
  };

  // Button handlers
  const handleRegister = async () => {
    if (!username || !password) {
      Alert.alert("Missing info", "Please enter both username and password.");
      return;
    }
    try {
      const existing = await getUserByName(username);
      if (existing) {
        Alert.alert("Username taken", "That username already exists. Try another.");
        return;
      }
      const pwHash = await hashPassword(username, password);
      await insertUser(username, pwHash);
      Alert.alert("Registered", "Account created. You can log in now.");
      setPassword("");
    } catch (e) {
      Alert.alert("Register error", e.message || "Could not register.");
    }
  };

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert("Missing info", "Please enter both username and password.");
      return;
    }
    try {
      const userRow = await getUserByName(username);
      const pwHash = await hashPassword(username, password);
      if (!userRow || userRow.password_hash !== pwHash) {
        Alert.alert(
          "Login failed",
          "Username/password does not exist. Please try again or register for a new account."
        );
        return;
      }
      const user = { username, loggedInAt: Date.now() }; // store username only
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
      setCurrent(user);
      setPassword("");
      Alert.alert("Welcome", `Logged in as ${username}`);
      redirectIfNeeded(); // ← jump to Saved if we came from there
    } catch (e) {
      Alert.alert("Login error", e.message || "Could not log in.");
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem(USER_KEY);
    setCurrent(null);
    setUsername("");
    setPassword("");
    Alert.alert("Logged out", "You have been logged out.");
  };

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.content, { gap: 12 }]}>
        <Text style={styles.header}>Profile</Text>

        {current ? (
          <>
            <Text style={{ fontSize: 16 }}>
              Logged in as <Text style={{ fontWeight: "700" }}>{current.username}</Text>
            </Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleLogout}>
              <Text style={styles.saveBtnText}>Log Out</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 16, opacity: 0.8 }}>
              Register a new account or log in with an existing one.
            </Text>

            <View style={{ width: "100%", gap: 10 }}>
              <TextInput
                placeholder="Username"
                value={username}
                onChangeText={setUsername}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                secureTextEntry
              />

              {/* Two buttons side by side: Log In | Register */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={handleLogin}>
                  <Text style={styles.saveBtnText}>Log In</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { flex: 1, backgroundColor: "#1e88e5" }]}
                  onPress={handleRegister}
                >
                  <Text style={styles.saveBtnText}>Register</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Recipe" component={RecipeScreen} />
        <Stack.Screen name="Saved" component={SavedRecipesScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  content: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  container: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "white",
  },

  header: { fontSize: 24, fontWeight: "800", marginBottom: 10, textAlign: "center" },
  subHeader: { fontSize: 18, marginTop: 18, marginBottom: 8, fontWeight: "600" },

  location: { fontSize: 18, color: "#1e88e5", marginBottom: 4, textAlign: "center" },
  weather: { fontSize: 18, color: "#ff9800", marginBottom: 12, textAlign: "center" },

  error: { fontSize: 16, color: "red", textAlign: "center" },

  card: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#eee",
    padding: 14,
    alignItems: "center",
  },
  image: { width: "100%", height: 160, borderRadius: 12, marginBottom: 10 },
  cardTitle: { fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 6 },
  cardCta: { fontSize: 14, opacity: 0.7 },

  detailImage: { width: "100%", height: 220, borderRadius: 12, marginBottom: 12 },
  step: { fontSize: 16, marginVertical: 4, lineHeight: 22 },

  saveBtn: {
    marginTop: 16,
    backgroundColor: "#4CAF50",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  saveBtnText: { color: "white", fontSize: 16, fontWeight: "700" },

  bottomBar: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "white",
  },
  bottomBtn: {
    flex: 1,
    backgroundColor: "#111827",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  bottomBtnText: { color: "white", fontSize: 16, fontWeight: "700" },
  bottomBtnSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#111827",
  },
  bottomBtnTextSecondary: { color: "#111827" },

  savedItem: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 14,
  },
  savedName: { fontSize: 16, fontWeight: "600" },

  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
});
