import { app } from "/scripts/app.js";

const EXTENSION_ID = "kiko-flux2-prompt-builder";
const NODE_NAME = "KikoFlux2PromptBuilder";
const ASSET_BASE = `/extensions/${EXTENSION_ID}`;
const API_BASE = `/${EXTENSION_ID}`;
const CUSTOM_PRESETS_KEY = "kikoFlux2CustomPresets";


const dataCache = {
  loaded: false,
  presets: {},
  styles: {},
  cameras: {},
  lighting: {},
  mood: {},
  composition: {},
};

function loadCustomPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.warn("Kiko builder: failed to load custom presets", err);
    return {};
  }
}

function saveCustomPresets(presets) {
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets || {}));
}

function slugifyPresetName(name) {
  return `${name || ""}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const defaultState = () => ({
  preset: "custom",
  prompt: "",
  style: "",
  cameraAngle: "",
  cameraShot: "",
  cameraLens: "",
  cameraAperture: "",
  cameraISO: "",
  cameraFocus: "",
  cameraModel: "",
  lighting: "",
  colors: [],
  colorMood: "",
  subjectDescription: "",
  subjectPosition: "center foreground",
  subjectAction: "",
  subjects: [],
  background: "",
  composition: "",
  includeEmpty: false,
  numericLens: false,
});

async function loadData() {
  if (dataCache.loaded) return dataCache;
  const names = ["presets", "styles", "cameras", "lighting", "mood", "composition"];
  for (const name of names) {
    // Try API endpoint first (more reliable), fallback to static file
    let res = await fetch(`${API_BASE}/data/${name}.json`);
    if (!res.ok) {
      // Fallback to static file path
      res = await fetch(`${ASSET_BASE}/data/${name}.json`);
    }
    if (!res.ok) throw new Error(`Failed to load ${name}`);
    dataCache[name] = await res.json();
  }
  dataCache.loaded = true;
  return dataCache;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || defaultState()));
}

function coercePalette(colors) {
  if (Array.isArray(colors)) return colors.map((c) => `${c}`.trim()).filter(Boolean);
  if (typeof colors === "string") return colors.split(",").map((c) => c.trim()).filter(Boolean);
  return [];
}

const commonTypoFixes = new Map([
  ["iclandic", "Icelandic"],
  ["brunnette", "brunette"],
  ["brunnete", "brunette"],
  ["brunettte", "brunette"],
  ["victorion", "Victorian"],
  ["victorian", "Victorian"],
  ["alight", "a light"],
]);

function cleanText(value) {
  const text = `${value || ""}`.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.replace(/\b(iclandic|brunnette|brunnete|brunettte|victorion|victorian|alight)\b/gi, (word) => commonTypoFixes.get(word.toLowerCase()) || word);
}

function applyPresetDefaults(state) {
  if (!state.preset || state.preset === "custom") return state;
  const preset = dataCache.presets?.[state.preset];
  if (!preset) return state;

  const next = cloneState(state);
  next.prompt = preset.prompt || "";
  next.style = preset.style || "";

  const cam = preset.camera || {};
  next.cameraAngle = cam.angle || "";
  next.cameraShot = cam.shot || "";
  next.cameraLens = cam.lens || "";
  next.cameraAperture = cam.aperture || "";
  next.cameraISO = cam.iso || "";
  next.cameraFocus = cam.focus || "";
  next.cameraModel = cam.model || "";

  next.lighting = preset.lighting || "";
  const colors = preset.colors || {};
  if (Array.isArray(colors.palette)) {
    next.colors = [...colors.palette];
  }
  next.colorMood = colors.mood || "";
  next.composition = preset.composition || "";
  return next;
}

function applyCustomPresetDefaults(state) {
  if (!state.preset || !state.preset.startsWith("custom:")) return state;
  const key = state.preset.slice("custom:".length);
  const custom = loadCustomPresets()[key];
  if (!custom?.state) return state;
  const next = { ...defaultState(), ...cloneState(custom.state), preset: state.preset };
  return next;
}

function presetLabelMap() {
  const options = [{ value: "custom", label: "— Select a preset —" }];
  Object.keys(dataCache.presets || {}).forEach((key) => {
    options.push({ value: key, label: dataCache.presets[key].name || key });
  });
  const customPresets = loadCustomPresets();
  const customKeys = Object.keys(customPresets).sort((a, b) => (customPresets[a].name || a).localeCompare(customPresets[b].name || b));
  if (customKeys.length) {
    options.push({ value: "", label: "── My Presets ──", disabled: true });
    customKeys.forEach((key) => options.push({ value: `custom:${key}`, label: customPresets[key].name || key }));
  }
  return options;
}

function saveCurrentAsCustomPreset(state) {
  const suggested = state.preset?.startsWith("custom:") ? loadCustomPresets()[state.preset.slice(7)]?.name : "";
  const name = window.prompt("Save current builder settings as preset:", suggested || "My FLUX preset");
  if (!name) return null;
  const key = slugifyPresetName(name);
  if (!key) return null;
  const presets = loadCustomPresets();
  const savedState = cloneState(state);
  savedState.preset = `custom:${key}`;
  presets[key] = { name: name.trim(), state: savedState, savedAt: new Date().toISOString() };
  saveCustomPresets(presets);
  state.preset = `custom:${key}`;
  return state.preset;
}

function deleteCurrentCustomPreset(state) {
  if (!state.preset?.startsWith("custom:")) return false;
  const key = state.preset.slice("custom:".length);
  const presets = loadCustomPresets();
  const name = presets[key]?.name || key;
  if (!window.confirm(`Delete custom preset "${name}"?`)) return false;
  delete presets[key];
  saveCustomPresets(presets);
  state.preset = "custom";
  return true;
}

function createTextarea(value, placeholder, onInput, extraClass = "") {
  const textarea = document.createElement("textarea");
  textarea.className = `kiko-field-input kiko-multiline-input ${extraClass}`.trim();
  textarea.placeholder = placeholder || "";
  textarea.value = value || "";
  textarea.spellcheck = true;
  textarea.oninput = () => onInput(textarea.value);
  return textarea;
}

function firstClause(text) {
  const clean = `${text || ""}`.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  for (const sep of [" with ", ",", ";", "."]) {
    if (clean.includes(sep)) {
      const first = clean.split(sep, 1)[0].trim();
      if (first) return first;
    }
  }
  return clean;
}

function backgroundFromPrompt(prompt) {
  const clean = `${prompt || ""}`.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const clauses = clean.split(",").map((part) => part.replace(/^[ .]+|[ .]+$/g, "")).filter(Boolean);
  for (let idx = 0; idx < clauses.length; idx += 1) {
    const loweredClause = clauses[idx].toLowerCase();
    if (["background", "behind", "backdrop"].some((marker) => loweredClause.includes(marker))) {
      return clauses.slice(idx, Math.min(clauses.length, idx + 2)).join(", ").replace(/^[ ,.]+|[ ,.]+$/g, "");
    }
  }
  const lowered = clean.toLowerCase();
  for (const marker of [" in the background", " behind ", " backdrop"]) {
    const idx = lowered.indexOf(marker);
    if (idx >= 0) return clean.slice(idx).replace(/^[ ,.]+|[ ,.]+$/g, "");
  }
  return "";
}

function cameraLensDescription(state) {
  const parts = [];
  const model = cleanText(state.cameraModel);
  const lens = cleanText(state.cameraLens);
  const aperture = cleanText(state.cameraAperture);
  const iso = cleanText(state.cameraISO);
  if (model) parts.push(model);
  if (lens) parts.push(lens.toLowerCase().includes("lens") ? lens : `${lens} lens`);
  if (aperture) parts.push(aperture);
  if (iso) parts.push(`ISO ${iso}`);
  return parts.join(", ");
}

function normalizeSubjects(state, palette, includeEmpty, scene) {
  const subjects = [];
  if (Array.isArray(state.subjects)) {
    state.subjects.forEach((raw) => {
      if (!raw || typeof raw !== "object") return;
      const subjectPalette = coercePalette(raw.color_palette || raw.colors || palette);
      const subject = {};
      const description = cleanText(raw.description);
      const position = cleanText(raw.position) || "center foreground";
      const action = cleanText(raw.action);
      if (description || includeEmpty) subject.description = description;
      if (position || includeEmpty) subject.position = position;
      if (action || includeEmpty) subject.action = action;
      if (subjectPalette.length || includeEmpty) subject.color_palette = subjectPalette;
      if (Object.keys(subject).length || includeEmpty) subjects.push(subject);
    });
  }
  if (subjects.length) return subjects;

  const fallback = {};
  const description = cleanText(state.subjectDescription || firstClause(scene));
  const position = cleanText(state.subjectPosition) || "center foreground";
  const action = cleanText(state.subjectAction);
  if (description || includeEmpty) fallback.description = description;
  if (position || includeEmpty) fallback.position = position;
  if (action || includeEmpty) fallback.action = action;
  if (palette.length || includeEmpty) fallback.color_palette = palette;
  return Object.keys(fallback).length || includeEmpty ? [fallback] : [];
}

function buildData(state) {
  const includeEmpty = !!state.includeEmpty;
  const palette = coercePalette(state.colors);

  const data = {};
  const scene = cleanText(state.prompt);
  if (scene || includeEmpty) data.scene = scene;

  const subjects = normalizeSubjects(state, palette, includeEmpty, scene);
  if (subjects.length || includeEmpty) data.subjects = subjects;

  const style = cleanText(state.style);
  const lighting = cleanText(state.lighting);
  const mood = cleanText(state.colorMood);
  const background = cleanText(state.background || backgroundFromPrompt(scene));
  const composition = cleanText(state.composition);

  if (style || includeEmpty) data.style = style;
  if (palette.length || includeEmpty) data.color_palette = palette;
  if (lighting || includeEmpty) data.lighting = lighting;
  if (mood || includeEmpty) data.mood = mood;
  if (background || includeEmpty) data.background = background;
  if (composition || includeEmpty) data.composition = composition;

  const camera = {};
  const cameraAngle = cleanText(state.cameraAngle);
  const cameraShot = cleanText(state.cameraShot);
  const cameraFocus = cleanText(state.cameraFocus);
  if (cameraAngle || includeEmpty) camera.angle = cameraAngle;
  if (cameraShot || includeEmpty) camera.distance = cameraShot;
  const lensDescription = cameraLensDescription(state);
  if (lensDescription || includeEmpty) camera.lens = lensDescription;
  if (cameraFocus || includeEmpty) camera.depth_of_field = cameraFocus;
  if (Object.keys(camera).length || includeEmpty) data.camera = camera;

  return data;
}

function buildText(data) {
  const parts = [];
  if (data.scene) parts.push(data.scene);
  if (data.style) parts.push(`Style: ${data.style}`);

  (data.subjects || []).forEach((subject) => {
    if (!subject?.description) return;
    const extras = [subject.position, subject.action].filter(Boolean);
    parts.push(`Subject: ${subject.description}${extras.length ? ` (${extras.join(", ")})` : ""}`);
  });

  const camera = data.camera || {};
  if (Object.keys(camera).length) {
    const desc = [];
    if (camera.angle) desc.push(`${camera.angle} angle`);
    if (camera.distance) desc.push(camera.distance);
    if (camera.lens) desc.push(camera.lens);
    if (desc.length) parts.push(`Camera: ${desc.join(", ")}`);
    if (camera.depth_of_field) parts.push(`Depth of field: ${camera.depth_of_field}`);
  }

  if (data.lighting) parts.push(`Lighting: ${data.lighting}`);
  if (data.color_palette?.length) parts.push(`Colors: ${data.color_palette.join(", ")}`);
  if (data.mood) parts.push(`Mood: ${data.mood}`);
  if (data.background) parts.push(`Background: ${data.background}`);
  if (data.composition) parts.push(`Composition: ${data.composition}`);
  return parts.join(". ");
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function ensureStyles() {
  if (document.getElementById("kiko-builder-styles")) return;
  const style = document.createElement("style");
  style.id = "kiko-builder-styles";
  style.textContent = `
  /* Custom Scrollbar - Webkit */
  .kiko-overlay ::-webkit-scrollbar { width: 10px; height: 10px; }
  .kiko-overlay ::-webkit-scrollbar-track { background: #1a1a2e; border-radius: 5px; }
  .kiko-overlay ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #7c3aed 0%, #5b21b6 100%); border-radius: 5px; border: 2px solid #1a1a2e; }
  .kiko-overlay ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #8b5cf6 0%, #6d28d9 100%); }

  .kiko-overlay { position: fixed; inset: 0; background: rgba(12,12,14,0.75); backdrop-filter: blur(6px); display: none; align-items: center; justify-content: center; z-index: 9999; font-family: 'Segoe UI', system-ui, sans-serif; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); box-sizing: border-box; }
  .kiko-overlay.show { display: flex; }

  .kiko-node { background: #2a2a2a; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: min(420px, 94vw); max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }

  .kiko-node-header { background: linear-gradient(135deg, #5a4fcf 0%, #7c3aed 100%); padding: 10px 14px; font-weight: 600; font-size: 13px; color: white; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .kiko-node-header-left { display: flex; align-items: center; gap: 8px; }
  .kiko-node-header-icon { width: 18px; height: 18px; background: rgba(255,255,255,0.2); border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 11px; }
  .kiko-close-btn { background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 16px; line-height: 1; display: flex; align-items: center; justify-content: center; }
  .kiko-close-btn:hover { background: rgba(255,255,255,0.3); }

  .kiko-node-body { padding: 12px; overflow-y: auto; flex: 1; }

  .kiko-field-group { margin-bottom: 12px; }
  .kiko-field-label { font-size: 11px; color: #888; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px; }
  .kiko-field-label .kiko-hint { font-size: 10px; color: #666; text-transform: none; letter-spacing: 0; }

  .kiko-field-input { width: 100%; background: #1e1e1e; border: 1px solid #3a3a3a; border-radius: 4px; padding: 8px 10px; color: #e0e0e0; font-size: 12px; transition: border-color 0.2s; box-sizing: border-box; }
  .kiko-field-input:focus { outline: none; border-color: #7c3aed; }
  .kiko-field-input::placeholder { color: #555; }
  textarea.kiko-field-input { min-height: 80px; resize: vertical; font-family: inherit; line-height: 1.5; }
  textarea.kiko-multiline-input { min-height: 44px; max-height: 220px; }
  textarea.kiko-short-textarea { min-height: 38px; }
  select.kiko-field-input { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 30px; }
  select.kiko-field-input optgroup { background: #1e1e1e; color: #888; font-style: normal; font-weight: 600; }
  select.kiko-field-input option { background: #1e1e1e; color: #e0e0e0; padding: 4px; }

  .kiko-sub-section { background: #252525; border-radius: 6px; padding: 10px; margin-bottom: 12px; }
  .kiko-sub-section-title { font-size: 11px; color: #7c3aed; font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
  .kiko-sub-section-title::before { content: ''; width: 8px; height: 8px; background: #7c3aed; border-radius: 2px; }

  .kiko-inline-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
  .kiko-subject-card { background: #1f1f1f; border: 1px solid #333; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
  .kiko-subject-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: #aaa; font-size: 11px; }
  .kiko-subject-actions { display: flex; gap: 6px; margin-top: 6px; }
  .kiko-small-btn { background: #333; border: 1px solid #555; border-radius: 4px; padding: 5px 8px; color: #ccc; font-size: 11px; cursor: pointer; }
  .kiko-small-btn:hover { background: #444; border-color: #7c3aed; color: #fff; }
  .kiko-small-btn-danger:hover { background: #4a1f1f; border-color: #ff6b6b; }

  /* Style selector with edit toggle */
  .kiko-style-selector { display: flex; gap: 4px; }
  .kiko-style-selector .kiko-style-dropdown { flex: 1; }
  .kiko-style-selector .kiko-style-text { flex: 1; display: none; }
  .kiko-style-selector.edit-mode .kiko-style-dropdown { display: none; }
  .kiko-style-selector.edit-mode .kiko-style-text { display: block; }
  .kiko-edit-toggle { background: #333; border: 1px solid #555; border-radius: 4px; width: 32px; height: 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #888; transition: all 0.2s; flex-shrink: 0; }
  .kiko-edit-toggle:hover { background: #444; border-color: #7c3aed; color: #ccc; }
  .kiko-style-selector.edit-mode .kiko-edit-toggle { background: #7c3aed; border-color: #7c3aed; color: white; }
  .kiko-edit-toggle svg { width: 14px; height: 14px; pointer-events: none; }

  /* Combo input */
  .kiko-combo-input { position: relative; }
  .kiko-combo-input input { padding-right: 30px; }
  .kiko-combo-input .kiko-dropdown-toggle { position: absolute; right: 1px; top: 1px; bottom: 1px; width: 28px; background: #2a2a2a; border: none; border-left: 1px solid #3a3a3a; border-radius: 0 3px 3px 0; cursor: pointer; color: #888; font-size: 10px; }
  .kiko-combo-input .kiko-dropdown-toggle:hover { background: #333; color: #aaa; }
  .kiko-combo-input .kiko-dropdown-menu { position: absolute; top: 100%; left: 0; right: 0; background: #1e1e1e; border: 1px solid #3a3a3a; border-radius: 4px; margin-top: 2px; max-height: 200px; overflow-y: auto; z-index: 100; display: none; }
  .kiko-combo-input .kiko-dropdown-menu.open { display: block; }
  .kiko-combo-input .kiko-dropdown-menu .kiko-option { padding: 6px 10px; font-size: 11px; color: #ccc; cursor: pointer; }
  .kiko-combo-input .kiko-dropdown-menu .kiko-option:hover { background: #2a2a2a; color: #fff; }
  .kiko-combo-input .kiko-dropdown-menu .kiko-option-header { padding: 4px 10px; font-size: 10px; color: #666; text-transform: uppercase; background: #252525; pointer-events: none; }

  /* Image picker section */
  .kiko-image-drop-zone { position: relative; background: #1a1a1a; border: 2px dashed #444; border-radius: 6px; min-height: 100px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; overflow: hidden; margin-bottom: 8px; }
  .kiko-image-drop-zone:hover { border-color: #7c3aed; background: #1e1e2a; }
  .kiko-image-drop-zone.drag-over { border-color: #7c3aed; background: #252535; border-style: solid; }
  .kiko-image-drop-zone.has-image { cursor: crosshair; border-style: solid; border-color: #3a3a3a; }
  .kiko-image-drop-zone.has-image:hover { border-color: #7c3aed; }
  .kiko-drop-zone-content { text-align: center; padding: 15px; }
  .kiko-drop-icon { font-size: 28px; margin-bottom: 6px; }
  .kiko-drop-text { font-size: 11px; color: #888; margin-bottom: 2px; }
  .kiko-drop-hint { font-size: 10px; color: #555; }
  .kiko-image-canvas { display: none; max-width: 100%; max-height: 200px; border-radius: 4px; }
  .kiko-image-drop-zone.has-image .kiko-image-canvas { display: block; }
  .kiko-image-drop-zone.has-image .kiko-drop-zone-content { display: none; }
  .kiko-clear-image-btn { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 50%; background: rgba(0, 0, 0, 0.7); border: 1px solid #555; color: #ccc; font-size: 14px; cursor: pointer; display: none; align-items: center; justify-content: center; transition: all 0.2s; line-height: 1; }
  .kiko-clear-image-btn:hover { background: #ff4444; border-color: #ff4444; color: white; }
  .kiko-image-drop-zone.has-image .kiko-clear-image-btn { display: flex; }
  .kiko-picked-color-preview { display: none; align-items: center; gap: 8px; margin-bottom: 8px; padding: 6px 8px; background: #1e1e1e; border: 1px solid #3a3a3a; border-radius: 4px; font-size: 11px; color: #888; }
  .kiko-picked-color-preview.visible { display: flex; }
  .kiko-preview-swatch { width: 24px; height: 24px; border-radius: 4px; border: 2px solid #555; background: #000; flex-shrink: 0; }

  /* Color palette */
  .kiko-color-palette { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .kiko-color-chip { display: flex; align-items: center; gap: 4px; background: #1e1e1e; border: 1px solid #3a3a3a; border-radius: 4px; padding: 4px 6px; }
  .kiko-color-chip input[type="color"] { width: 22px; height: 22px; padding: 0; border: 1px solid #555; border-radius: 3px; cursor: pointer; background: transparent; }
  .kiko-color-chip input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  .kiko-color-chip input[type="color"]::-webkit-color-swatch { border: none; border-radius: 2px; }
  .kiko-color-chip input[type="text"] { background: transparent; border: none; color: #e0e0e0; width: 90px; font-size: 11px; }
  .kiko-color-chip input[type="text"]:focus { outline: none; }
  .kiko-eyedropper-btn { background: #333; border: 1px solid #555; border-radius: 3px; width: 22px; height: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #ccc; transition: all 0.2s; flex-shrink: 0; }
  .kiko-eyedropper-btn:hover:not(:disabled) { background: #444; border-color: #7c3aed; color: #fff; }
  .kiko-eyedropper-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .kiko-eyedropper-btn svg { width: 12px; height: 12px; pointer-events: none; }
  .kiko-remove-color-btn { background: none; border: none; color: #666; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
  .kiko-remove-color-btn:hover { color: #ff6b6b; }
  .kiko-add-color-btn { background: #333; border: 1px dashed #555; border-radius: 4px; padding: 4px 10px; font-size: 11px; color: #888; cursor: pointer; transition: all 0.2s; }
  .kiko-add-color-btn:hover { background: #3a3a3a; border-color: #7c3aed; color: #aaa; }

  /* Toggle switch */
  .kiko-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
  .kiko-toggle-label { font-size: 11px; color: #aaa; }
  .kiko-toggle-switch { position: relative; width: 36px; height: 20px; }
  .kiko-toggle-switch input { opacity: 0; width: 0; height: 0; }
  .kiko-toggle-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; transition: 0.3s; border-radius: 20px; }
  .kiko-toggle-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: #888; transition: 0.3s; border-radius: 50%; }
  .kiko-toggle-switch input:checked + .kiko-toggle-slider { background-color: #7c3aed; }
  .kiko-toggle-switch input:checked + .kiko-toggle-slider:before { transform: translateX(16px); background-color: white; }

  /* Preset section */
  .kiko-preset-section { margin-bottom: 15px; padding-bottom: 12px; border-bottom: 1px solid #3a3a3a; }
  .kiko-preset-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }

  /* Footer */
  .kiko-node-footer { padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid #3a3a3a; display: flex; justify-content: flex-end; gap: 8px; background: #222; position: sticky; bottom: 0; z-index: 5; }
  .kiko-btn { padding: 8px 16px; border-radius: 4px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
  .kiko-btn-primary { background: linear-gradient(135deg, #5a4fcf 0%, #7c3aed 100%); color: white; }
  .kiko-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3); }
  .kiko-btn-secondary { background: #333; color: #ccc; border: 1px solid #444; }
  .kiko-btn-secondary:hover { background: #444; color: #fff; }

  /* JSON preview */
  .kiko-json-preview { background: #0d0d0d; border: 1px solid #333; border-radius: 4px; padding: 10px; font-family: 'Fira Code', 'Consolas', monospace; font-size: 10px; color: #a0e0a0; white-space: pre-wrap; word-break: break-word; max-height: 150px; overflow-y: auto; line-height: 1.5; margin-top: 12px; }
  .kiko-json-preview .kiko-json-key { color: #9cdcfe; }
  .kiko-json-preview .kiko-json-string { color: #ce9178; }
  .kiko-json-preview .kiko-json-number { color: #b5cea8; }

  @media (max-width: 640px) {
    .kiko-overlay { align-items: stretch; justify-content: stretch; padding: 0; }
    .kiko-node { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; }
    .kiko-node-header { padding-top: calc(10px + env(safe-area-inset-top)); }
    .kiko-node-body { padding: 10px; -webkit-overflow-scrolling: touch; }
    .kiko-inline-fields { grid-template-columns: 1fr; }
    .kiko-style-selector { align-items: stretch; }
    .kiko-style-selector.edit-mode { flex-direction: column; }
    .kiko-style-selector.edit-mode .kiko-edit-toggle { width: 100%; height: 34px; }
    .kiko-node-footer { justify-content: stretch; }
    .kiko-node-footer .kiko-btn { flex: 1; min-height: 44px; font-size: 14px; }
    .kiko-preset-actions .kiko-small-btn { flex: 1; min-height: 36px; }
  }
  `;
  document.head.appendChild(style);
}

function findWidget(node, name) {
  return (node.widgets || []).find((w) => w.name === name);
}

function syncWidgets(node, state) {
  const mapping = {
    prompt: "prompt",
    preset: "preset",
    style: "style",
    camera_angle: "cameraAngle",
    camera_shot: "cameraShot",
    camera_lens: "cameraLens",
    camera_aperture: "cameraAperture",
    camera_iso: "cameraISO",
    camera_focus: "cameraFocus",
    camera_model: "cameraModel",
    lighting: "lighting",
    color_palette: "colors",
    color_mood: "colorMood",
    subject_description: "subjectDescription",
    subject_position: "subjectPosition",
    subject_action: "subjectAction",
    background: "background",
    composition: "composition",
    include_empty_fields: "includeEmpty",
    numeric_lens_format: "numericLens",
    builder_payload: null,
  };

  Object.entries(mapping).forEach(([widgetName, stateKey]) => {
    const widget = findWidget(node, widgetName);
    if (!widget) return;
    if (stateKey === null) {
      widget.value = JSON.stringify(state);
      return;
    }
    if (stateKey === "colors") {
      widget.value = coercePalette(state.colors).join(", ");
      return;
    }
    let value = state[stateKey];
    // Custom presets are stored in browser localStorage and restored through
    // builder_payload. Do not write custom:<slug> into ComfyUI's preset input:
    // Comfy validates list-style preset inputs before the frontend can repair them.
    if (widgetName === "preset" && typeof value === "string" && value.startsWith("custom:")) {
      value = "custom";
    }
    widget.value = typeof value === "boolean" ? value : value ?? "";
  });
}

function attachBuilder(nodeType) {
  const origOnNodeCreated = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    origOnNodeCreated?.apply(this, arguments);
    setupNode(this);
  };

  const origSerialize = nodeType.prototype.serialize;
  nodeType.prototype.serialize = function () {
    const data = origSerialize ? origSerialize.apply(this, arguments) : {};
    data.kiko_payload = JSON.stringify(this.kikoState || {});
    return data;
  };

  const origConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function (info) {
    try {
      if (info?.kiko_payload) {
        const parsed = JSON.parse(info.kiko_payload);
        if (parsed && typeof parsed === "object") this.kikoState = parsed;
      }
    } catch (err) {
      console.warn("Kiko builder: failed to restore state", err);
    }
    origConfigure?.apply(this, arguments);
  };
}

function setupNode(node) {
  node.kikoState = node.kikoState || defaultState();
  if (!node.builderButton) {
    node.builderButton = node.addWidget?.("button", "Open Builder", "open", () => openBuilder(node));
  }
  if (!findWidget(node, "builder_payload") && node.addWidget) {
    node.addWidget("text", "builder_payload", "", () => {});
  }
}

// Camera settings dropdown options
const cameraOptions = {
  angle: {
    "Common Angles": [
      { value: "eye level", label: "eye level (natural)" },
      { value: "low angle", label: "low angle (powerful)" },
      { value: "high angle", label: "high angle (diminishing)" },
      { value: "bird's-eye", label: "bird's-eye (architectural)" },
      { value: "worm's-eye", label: "worm's-eye (dramatic)" },
    ],
    "Subtle Variations": [
      { value: "slightly low", label: "slightly low" },
      { value: "slightly high", label: "slightly high" },
    ],
    "Creative Angles": [
      { value: "Dutch angle", label: "Dutch angle (tilted)" },
      { value: "over-the-shoulder", label: "over-the-shoulder (intimate)" },
      { value: "overhead flat lay", label: "overhead flat lay" },
      { value: "ground level", label: "ground level" },
      { value: "dynamic angle", label: "dynamic angle" },
    ],
  },
  shot: {
    "Standard Shots": [
      { value: "extreme close-up", label: "extreme close-up" },
      { value: "close-up", label: "close-up" },
      { value: "medium close-up", label: "medium close-up" },
      { value: "medium shot", label: "medium shot" },
      { value: "medium full shot", label: "medium full shot" },
      { value: "full body", label: "full body" },
      { value: "wide shot", label: "wide shot" },
    ],
    "Specialized": [
      { value: "macro detail", label: "macro detail" },
      { value: "tight detail", label: "tight detail" },
      { value: "product close-up", label: "product close-up" },
      { value: "intimate close-up", label: "intimate close-up" },
    ],
    "Motion Shots": [
      { value: "tracking shot", label: "tracking shot" },
      { value: "action shot", label: "action shot" },
      { value: "full body action", label: "full body action" },
    ],
  },
  lens: {
    "Wide (Dramatic)": [
      { value: "14mm", label: "14mm (ultra-wide)" },
      { value: "24mm", label: "24mm (wide)" },
      { value: "28mm", label: "28mm (wide)" },
    ],
    "Natural": [
      { value: "35mm", label: "35mm (natural)" },
      { value: "50mm", label: "50mm (standard)" },
    ],
    "Portrait / Telephoto": [
      { value: "70mm", label: "70mm" },
      { value: "85mm", label: "85mm (portrait)" },
      { value: "100mm", label: "100mm" },
      { value: "135mm", label: "135mm (telephoto)" },
      { value: "200mm", label: "200mm (telephoto)" },
    ],
    "Specialty": [
      { value: "100mm macro", label: "100mm macro" },
      { value: "fisheye", label: "fisheye" },
      { value: "tilt-shift", label: "tilt-shift" },
    ],
  },
  aperture: {
    "Shallow DOF (Blurred BG)": [
      { value: "f/1.2", label: "f/1.2 (very shallow)" },
      { value: "f/1.4", label: "f/1.4 (shallow)" },
      { value: "f/1.8", label: "f/1.8" },
      { value: "f/2.0", label: "f/2.0" },
      { value: "f/2.8", label: "f/2.8 (portrait)" },
    ],
    "Moderate DOF": [
      { value: "f/4", label: "f/4" },
      { value: "f/5.6", label: "f/5.6 (balanced)" },
    ],
    "Deep DOF (Sharp BG)": [
      { value: "f/8", label: "f/8 (landscape)" },
      { value: "f/11", label: "f/11 (sharp)" },
      { value: "f/16", label: "f/16 (deep focus)" },
    ],
  },
  iso: {
    "Low (Clean)": [
      { value: "100", label: "100 (cleanest)" },
      { value: "200", label: "200" },
      { value: "400", label: "400" },
    ],
    "Medium": [
      { value: "800", label: "800" },
      { value: "1600", label: "1600" },
    ],
    "High (Grainy)": [
      { value: "3200", label: "3200 (noisy)" },
      { value: "6400", label: "6400 (grainy)" },
    ],
  },
};

const eyeDropperIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>`;
const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;

let ui = null;
let currentNode = null;
let currentState = null;
let imageCanvas = null;
let canvasCtx = null;

async function openBuilder(node) {
  await loadData();
  if (!ui) ui = createOverlay();

  currentNode = node;
  currentState = applyCustomPresetDefaults(applyPresetDefaults(cloneState(node.kikoState || defaultState())));

  renderForm(ui, currentState);
  ui.overlay.classList.add("show");
}

function closeBuilder() {
  currentNode = null;
  currentState = null;
  if (ui) ui.overlay.classList.remove("show");
}

function createOverlay() {
  ensureStyles();
  const overlay = createElement("div", "kiko-overlay");

  const node = createElement("div", "kiko-node");

  // Header
  const header = createElement("div", "kiko-node-header");
  const headerLeft = createElement("div", "kiko-node-header-left");
  const icon = createElement("div", "kiko-node-header-icon", "✨");
  const title = createElement("span", "", "FLUX 2 Prompt Builder");
  headerLeft.append(icon, title);
  const closeBtn = createElement("button", "kiko-close-btn", "×");
  closeBtn.onclick = closeBuilder;
  header.append(headerLeft, closeBtn);

  // Body
  const body = createElement("div", "kiko-node-body");

  // Footer
  const footer = createElement("div", "kiko-node-footer");
  const cancelBtn = createElement("button", "kiko-btn kiko-btn-secondary", "Cancel");
  cancelBtn.onclick = closeBuilder;
  const applyBtn = createElement("button", "kiko-btn kiko-btn-primary", "Apply");
  footer.append(cancelBtn, applyBtn);

  node.append(header, body, footer);
  overlay.appendChild(node);
  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeBuilder();
  });

  return { overlay, node, body, applyBtn };
}

function flattenOptionsToSelect(grouped, includeEmptyLabel = true) {
  const options = includeEmptyLabel ? [{ value: "", label: "— select —" }] : [];
  Object.entries(grouped || {}).forEach(([label, items]) => {
    if (!Array.isArray(items)) return;
    options.push({ value: "", label: `── ${label} ──`, disabled: true });
    items.forEach((item) => {
      options.push({ value: item.prompt || "", label: item.name || item.prompt || "" });
    });
  });
  return options;
}

function buildSelect(options, current) {
  const select = document.createElement("select");
  select.className = "kiko-field-input";
  options.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.disabled) option.disabled = true;
    if (opt.value === current) option.selected = true;
    select.appendChild(option);
  });
  return select;
}

function createComboInput(id, placeholder, options, value, onChange) {
  const wrapper = createElement("div", "kiko-combo-input");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "kiko-field-input";
  input.placeholder = placeholder;
  input.value = value || "";
  input.oninput = () => onChange(input.value);

  const toggleBtn = createElement("button", "kiko-dropdown-toggle", "▼");

  const menu = createElement("div", "kiko-dropdown-menu");
  menu.id = `kiko-menu-${id}`;

  Object.entries(options).forEach(([group, items]) => {
    const header = createElement("div", "kiko-option-header", group);
    menu.appendChild(header);
    items.forEach((item) => {
      const opt = createElement("div", "kiko-option", item.label);
      opt.dataset.value = item.value;
      opt.onclick = () => {
        input.value = item.value;
        menu.classList.remove("open");
        onChange(item.value);
      };
      menu.appendChild(opt);
    });
  });

  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll(".kiko-dropdown-menu.open").forEach((m) => {
      if (m !== menu) m.classList.remove("open");
    });
    menu.classList.toggle("open");
  };

  wrapper.append(input, toggleBtn, menu);
  return wrapper;
}

function createStyleSelector(dropdown, textInput, currentValue, onChange) {
  const wrapper = createElement("div", "kiko-style-selector");

  dropdown.className = "kiko-field-input kiko-style-dropdown";
  dropdown.onchange = () => {
    textInput.value = dropdown.value;
    onChange(dropdown.value);
  };

  if (textInput.tagName === "INPUT") textInput.type = "text";
  textInput.className = "kiko-field-input kiko-style-text kiko-multiline-input";
  textInput.spellcheck = true;
  textInput.value = currentValue || "";
  textInput.oninput = () => {
    onChange(textInput.value);
  };

  const editBtn = createElement("button", "kiko-edit-toggle");
  editBtn.innerHTML = editIcon;
  editBtn.title = "Edit raw text";
  editBtn.onclick = () => {
    wrapper.classList.toggle("edit-mode");
    if (wrapper.classList.contains("edit-mode")) {
      textInput.focus();
    }
  };

  wrapper.append(dropdown, textInput, editBtn);
  return wrapper;
}

function highlightJSON(json) {
  const str = JSON.stringify(json, null, 2);
  return str
    .replace(/"([^"]+)":/g, '<span class="kiko-json-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="kiko-json-string">"$1"</span>')
    .replace(/: (\d+)/g, ': <span class="kiko-json-number">$1</span>');
}

function updatePreview(previewEl, state) {
  const data = buildData(state);
  previewEl.innerHTML = highlightJSON(data);
}

function renderSubjects(container, state, onChange) {
  if (!Array.isArray(state.subjects) || !state.subjects.length) {
    const description = state.subjectDescription || "";
    const position = state.subjectPosition || "center foreground";
    const action = state.subjectAction || "";
    state.subjects = description || action ? [{ description, position, action, color_palette: coercePalette(state.colors) }] : [];
  }

  container.innerHTML = "";
  const subjects = state.subjects;
  subjects.forEach((subject, idx) => {
    const card = createElement("div", "kiko-subject-card");
    const header = createElement("div", "kiko-subject-card-header");
    header.append(createElement("span", "", `Subject ${idx + 1}`));
    const remove = createElement("button", "kiko-small-btn kiko-small-btn-danger", "Remove");
    remove.onclick = () => {
      subjects.splice(idx, 1);
      renderSubjects(container, state, onChange);
      onChange();
    };
    header.appendChild(remove);
    card.appendChild(header);

    const desc = createTextarea(subject.description || "", "Subject description, e.g. Icelandic brunette woman", (v) => {
      subject.description = v;
      state.subjectDescription = subjects[0]?.description || "";
      onChange();
    }, "kiko-short-textarea");
    card.appendChild(desc);

    const row = createElement("div", "kiko-inline-fields");
    const pos = document.createElement("input");
    pos.type = "text";
    pos.spellcheck = true;
    pos.className = "kiko-field-input";
    pos.placeholder = "center foreground";
    pos.value = subject.position || "center foreground";
    pos.oninput = () => {
      subject.position = pos.value;
      state.subjectPosition = subjects[0]?.position || "center foreground";
      onChange();
    };
    const action = createTextarea(subject.action || "", "lying on a bed, holding hands", (v) => {
      subject.action = v;
      state.subjectAction = subjects[0]?.action || "";
      onChange();
    }, "kiko-short-textarea");
    row.append(pos, action);
    card.appendChild(row);
    container.appendChild(card);
  });

  const actions = createElement("div", "kiko-subject-actions");
  const addBtn = createElement("button", "kiko-small-btn", "+ Add Subject");
  addBtn.onclick = () => {
    subjects.push({ description: "", position: subjects.length ? "right center foreground" : "center foreground", action: "", color_palette: coercePalette(state.colors) });
    renderSubjects(container, state, onChange);
    onChange();
  };
  actions.appendChild(addBtn);
  container.appendChild(actions);
}

function renderColors(container, state, onChange) {
  container.innerHTML = "";
  const colors = coercePalette(state.colors);
  const eyeDropperSupported = "EyeDropper" in window && window.isSecureContext;

  colors.forEach((color, idx) => {
    const chip = createElement("div", "kiko-color-chip");
    const isHex = color.startsWith("#");

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = isHex ? color : "#888888";
    colorInput.title = "Pick a color";
    colorInput.oninput = (e) => {
      colors[idx] = e.target.value;
      textInput.value = e.target.value;
      state.colors = [...colors];
      onChange();
    };

    const eyeBtn = createElement("button", "kiko-eyedropper-btn");
    eyeBtn.innerHTML = eyeDropperIcon;
    eyeBtn.title = eyeDropperSupported ? "Pick color from screen" : "Eye dropper requires HTTPS";
    eyeBtn.disabled = !eyeDropperSupported;
    eyeBtn.onclick = async () => {
      if (!eyeDropperSupported) return;
      try {
        const eyeDropper = new EyeDropper();
        const result = await eyeDropper.open();
        colors[idx] = result.sRGBHex;
        state.colors = [...colors];
        renderColors(container, state, onChange);
        onChange();
      } catch (err) {
        console.log("EyeDropper cancelled:", err);
      }
    };

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = color;
    textInput.placeholder = "Color name or hex";
    textInput.oninput = (e) => {
      colors[idx] = e.target.value;
      if (e.target.value.match(/^#[0-9a-fA-F]{6}$/)) {
        colorInput.value = e.target.value;
      }
      state.colors = [...colors];
      onChange();
    };

    const removeBtn = createElement("button", "kiko-remove-color-btn", "×");
    removeBtn.onclick = () => {
      colors.splice(idx, 1);
      state.colors = [...colors];
      renderColors(container, state, onChange);
      onChange();
    };

    chip.append(colorInput, eyeBtn, textInput, removeBtn);
    container.appendChild(chip);
  });

  const addBtn = createElement("button", "kiko-add-color-btn", "+ Add Color");
  addBtn.onclick = () => {
    colors.push("#FFFFFF");
    state.colors = [...colors];
    renderColors(container, state, onChange);
    onChange();
  };
  container.appendChild(addBtn);
}

function renderForm(uiParts, state) {
  const { body, applyBtn } = uiParts;
  body.innerHTML = "";

  const fieldGroup = (label, ...children) => {
    const group = createElement("div", "kiko-field-group");
    const lbl = createElement("div", "kiko-field-label", label);
    group.appendChild(lbl);
    children.forEach((c) => group.appendChild(c));
    return group;
  };

  const previewEl = createElement("pre", "kiko-json-preview");
  const update = () => updatePreview(previewEl, state);

  // Preset section
  const presetSection = createElement("div", "kiko-preset-section");
  const presetSelect = buildSelect(presetLabelMap(), state.preset);
  presetSelect.onchange = () => {
    state.preset = presetSelect.value || "custom";
    if (state.preset.startsWith("custom:")) {
      Object.assign(state, applyCustomPresetDefaults({ ...defaultState(), preset: state.preset }));
    } else if (state.preset !== "custom") {
      const merged = applyPresetDefaults({ ...defaultState(), preset: state.preset });
      Object.assign(state, merged);
    }
    renderForm(uiParts, state);
  };
  presetSection.appendChild(fieldGroup("Load Preset", presetSelect));
  const presetActions = createElement("div", "kiko-preset-actions");
  const savePresetBtn = createElement("button", "kiko-small-btn", "Save Current as Preset");
  savePresetBtn.onclick = () => {
    if (saveCurrentAsCustomPreset(state)) renderForm(uiParts, state);
  };
  presetActions.appendChild(savePresetBtn);
  if (state.preset?.startsWith("custom:")) {
    const deletePresetBtn = createElement("button", "kiko-small-btn kiko-small-btn-danger", "Delete This Preset");
    deletePresetBtn.onclick = () => {
      if (deleteCurrentCustomPreset(state)) renderForm(uiParts, state);
    };
    presetActions.appendChild(deletePresetBtn);
  }
  presetSection.appendChild(presetActions);
  body.appendChild(presetSection);

  // Main Prompt
  const promptInput = createTextarea(state.prompt, "Describe your scene in detail...", (v) => {
    state.prompt = v;
    update();
  });
  body.appendChild(fieldGroup("Main Prompt", promptInput));

  // Style
  const styleOptions = flattenOptionsToSelect(dataCache.styles, true);
  const styleDropdown = buildSelect(styleOptions, state.style);
  const styleText = createTextarea(state.style, "e.g., photorealistic, cinematic lighting", () => {});
  const styleSelector = createStyleSelector(styleDropdown, styleText, state.style, (v) => {
    state.style = v;
    update();
  });
  body.appendChild(fieldGroup("Style", styleSelector));

  // Official FLUX.2 subject/background controls
  const structureSection = createElement("div", "kiko-sub-section");
  structureSection.appendChild(createElement("div", "kiko-sub-section-title", "Official FLUX.2 Structure"));

  const subjectContainer = createElement("div", "kiko-subject-list");
  renderSubjects(subjectContainer, state, update);
  structureSection.appendChild(fieldGroup("Subjects", subjectContainer));

  const backgroundInput = createTextarea(state.background || "", "Background details; inferred from scene if blank", (v) => {
    state.background = v;
    update();
  });
  structureSection.appendChild(fieldGroup("Background", backgroundInput));

  body.appendChild(structureSection);

  // Camera Settings sub-section
  const cameraSection = createElement("div", "kiko-sub-section");
  const cameraTitle = createElement("div", "kiko-sub-section-title", "Camera Settings");
  cameraSection.appendChild(cameraTitle);

  const row1 = createElement("div", "kiko-inline-fields");
  const angleGroup = createElement("div", "kiko-field-group");
  angleGroup.appendChild(createElement("div", "kiko-field-label", "Angle"));
  angleGroup.appendChild(
    createComboInput("angle", "eye level", cameraOptions.angle, state.cameraAngle, (v) => {
      state.cameraAngle = v;
      update();
    })
  );
  const shotGroup = createElement("div", "kiko-field-group");
  shotGroup.appendChild(createElement("div", "kiko-field-label", "Shot / Distance"));
  shotGroup.appendChild(
    createComboInput("shot", "medium shot", cameraOptions.shot, state.cameraShot, (v) => {
      state.cameraShot = v;
      update();
    })
  );
  row1.append(angleGroup, shotGroup);
  cameraSection.appendChild(row1);

  const row2 = createElement("div", "kiko-inline-fields");
  const lensGroup = createElement("div", "kiko-field-group");
  lensGroup.appendChild(createElement("div", "kiko-field-label", "Lens (mm)"));
  lensGroup.appendChild(
    createComboInput("lens", "50mm", cameraOptions.lens, state.cameraLens, (v) => {
      state.cameraLens = v;
      update();
    })
  );
  const apertureGroup = createElement("div", "kiko-field-group");
  apertureGroup.appendChild(createElement("div", "kiko-field-label", "Aperture"));
  apertureGroup.appendChild(
    createComboInput("aperture", "f/2.8", cameraOptions.aperture, state.cameraAperture, (v) => {
      state.cameraAperture = v;
      update();
    })
  );
  row2.append(lensGroup, apertureGroup);
  cameraSection.appendChild(row2);

  const row3 = createElement("div", "kiko-inline-fields");
  const isoGroup = createElement("div", "kiko-field-group");
  isoGroup.appendChild(createElement("div", "kiko-field-label", "ISO"));
  isoGroup.appendChild(
    createComboInput("iso", "100", cameraOptions.iso, state.cameraISO, (v) => {
      state.cameraISO = v;
      update();
    })
  );
  const focusGroup = createElement("div", "kiko-field-group");
  focusGroup.appendChild(createElement("div", "kiko-field-label", "Focus Description"));
  const focusInput = createTextarea(state.cameraFocus, "Sharp focus on subject", (v) => {
    state.cameraFocus = v;
    update();
  }, "kiko-short-textarea");
  focusGroup.appendChild(focusInput);
  row3.append(isoGroup, focusGroup);
  cameraSection.appendChild(row3);

  // Camera / Film Stock
  const cameraModelGroup = createElement("div", "kiko-field-group");
  const cameraModelLabel = createElement("div", "kiko-field-label");
  cameraModelLabel.innerHTML = 'Camera / Film Stock <span class="kiko-hint">(optional)</span>';
  cameraModelGroup.appendChild(cameraModelLabel);
  const cameraOptions2 = flattenOptionsToSelect(dataCache.cameras, true);
  const cameraDropdown = buildSelect(cameraOptions2, state.cameraModel);
  const cameraText = createTextarea(state.cameraModel, "e.g., Shot on Sony A7 IV, Kodak Portra 400", () => {}, "kiko-short-textarea");
  const cameraSelector = createStyleSelector(cameraDropdown, cameraText, state.cameraModel, (v) => {
    state.cameraModel = v;
    update();
  });
  cameraModelGroup.appendChild(cameraSelector);
  cameraSection.appendChild(cameraModelGroup);

  body.appendChild(cameraSection);

  // Lighting sub-section
  const lightingSection = createElement("div", "kiko-sub-section");
  lightingSection.appendChild(createElement("div", "kiko-sub-section-title", "Lighting"));
  const lightingOptions = flattenOptionsToSelect(dataCache.lighting, true);
  const lightingDropdown = buildSelect(lightingOptions, state.lighting);
  const lightingText = createTextarea(state.lighting, "e.g., Golden hour, three-point lighting", () => {}, "kiko-short-textarea");
  const lightingSelector = createStyleSelector(lightingDropdown, lightingText, state.lighting, (v) => {
    state.lighting = v;
    update();
  });
  lightingSection.appendChild(fieldGroup("", lightingSelector));
  body.appendChild(lightingSection);

  // Color Palette sub-section
  const colorSection = createElement("div", "kiko-sub-section");
  colorSection.appendChild(createElement("div", "kiko-sub-section-title", "Color Palette"));

  // Image picker
  const imageDropZone = createElement("div", "kiko-image-drop-zone");
  const dropContent = createElement("div", "kiko-drop-zone-content");
  dropContent.innerHTML = `
    <div class="kiko-drop-icon">🖼️</div>
    <div class="kiko-drop-text">Drop image here or click to upload</div>
    <div class="kiko-drop-hint">Click on image to pick colors</div>
  `;
  imageCanvas = document.createElement("canvas");
  imageCanvas.className = "kiko-image-canvas";
  const clearImageBtn = createElement("button", "kiko-clear-image-btn", "×");
  const imageInput = document.createElement("input");
  imageInput.type = "file";
  imageInput.accept = "image/*";
  imageInput.style.display = "none";

  const pickedColorPreview = createElement("div", "kiko-picked-color-preview");
  const previewSwatch = createElement("div", "kiko-preview-swatch");
  const previewHex = createElement("span", "", "Click image to add color");
  pickedColorPreview.append(previewSwatch, previewHex);

  imageDropZone.append(dropContent, imageCanvas, clearImageBtn);
  colorSection.append(imageDropZone, imageInput, pickedColorPreview);

  // Setup image picker events
  canvasCtx = imageCanvas.getContext("2d", { willReadFrequently: true });

  imageDropZone.onclick = (e) => {
    if (e.target === imageCanvas || e.target === clearImageBtn) return;
    if (!imageDropZone.classList.contains("has-image")) {
      imageInput.click();
    }
  };

  imageInput.onchange = (e) => {
    if (e.target.files?.[0]) loadImageToCanvas(e.target.files[0], imageDropZone, imageCanvas, canvasCtx, pickedColorPreview);
  };

  imageDropZone.ondragover = (e) => {
    e.preventDefault();
    imageDropZone.classList.add("drag-over");
  };
  imageDropZone.ondragleave = (e) => {
    e.preventDefault();
    imageDropZone.classList.remove("drag-over");
  };
  imageDropZone.ondrop = (e) => {
    e.preventDefault();
    imageDropZone.classList.remove("drag-over");
    const files = e.dataTransfer.files;
    if (files?.[0]?.type.startsWith("image/")) {
      loadImageToCanvas(files[0], imageDropZone, imageCanvas, canvasCtx, pickedColorPreview);
    }
  };

  clearImageBtn.onclick = (e) => {
    e.stopPropagation();
    canvasCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    imageCanvas.width = 0;
    imageCanvas.height = 0;
    imageInput.value = "";
    imageDropZone.classList.remove("has-image");
    pickedColorPreview.classList.remove("visible");
  };

  imageCanvas.onmousemove = (e) => {
    if (!imageDropZone.classList.contains("has-image")) return;
    const hex = getCanvasColorAt(e, imageCanvas, canvasCtx);
    previewSwatch.style.backgroundColor = hex;
    previewHex.textContent = hex;
  };

  imageCanvas.onclick = (e) => {
    if (!imageDropZone.classList.contains("has-image")) return;
    const hex = getCanvasColorAt(e, imageCanvas, canvasCtx);
    state.colors = coercePalette(state.colors);
    state.colors.push(hex);
    renderColors(paletteContainer, state, update);
    update();
    pickedColorPreview.style.borderColor = "#7c3aed";
    setTimeout(() => {
      pickedColorPreview.style.borderColor = "#3a3a3a";
    }, 200);
  };

  // Color palette chips
  const paletteContainer = createElement("div", "kiko-color-palette");
  renderColors(paletteContainer, state, update);
  colorSection.appendChild(paletteContainer);

  // Color Mood
  const moodOptions = flattenOptionsToSelect(dataCache.mood, true);
  const moodDropdown = buildSelect(moodOptions, state.colorMood);
  const moodText = createTextarea(state.colorMood, "e.g., moody yet vibrant", () => {}, "kiko-short-textarea");
  const moodSelector = createStyleSelector(moodDropdown, moodText, state.colorMood, (v) => {
    state.colorMood = v;
    update();
  });
  colorSection.appendChild(fieldGroup("Mood", moodSelector));

  body.appendChild(colorSection);

  // Composition sub-section
  const compositionSection = createElement("div", "kiko-sub-section");
  compositionSection.appendChild(createElement("div", "kiko-sub-section-title", "Composition"));
  const compositionOptions = flattenOptionsToSelect(dataCache.composition, true);
  const compositionDropdown = buildSelect(compositionOptions, state.composition);
  const compositionText = createTextarea(state.composition, "rule of thirds, leading lines", () => {}, "kiko-short-textarea");
  const compositionSelector = createStyleSelector(compositionDropdown, compositionText, state.composition, (v) => {
    state.composition = v;
    update();
  });
  compositionSection.appendChild(compositionSelector);
  body.appendChild(compositionSection);

  // Output Options sub-section
  const outputSection = createElement("div", "kiko-sub-section");
  outputSection.appendChild(createElement("div", "kiko-sub-section-title", "Output Options"));

  const toggleRow1 = createElement("div", "kiko-toggle-row");
  const toggleLabel1 = createElement("span", "kiko-toggle-label", "Include empty fields");
  const toggleSwitch1 = createElement("label", "kiko-toggle-switch");
  const toggleInput1 = document.createElement("input");
  toggleInput1.type = "checkbox";
  toggleInput1.checked = state.includeEmpty;
  toggleInput1.onchange = () => {
    state.includeEmpty = toggleInput1.checked;
    update();
  };
  const toggleSlider1 = createElement("span", "kiko-toggle-slider");
  toggleSwitch1.append(toggleInput1, toggleSlider1);
  toggleRow1.append(toggleLabel1, toggleSwitch1);
  outputSection.appendChild(toggleRow1);

  const toggleRow2 = createElement("div", "kiko-toggle-row");
  const toggleLabel2 = createElement("span", "kiko-toggle-label", "Deprecated legacy lens-mm toggle (ignored)");
  const toggleSwitch2 = createElement("label", "kiko-toggle-switch");
  const toggleInput2 = document.createElement("input");
  toggleInput2.type = "checkbox";
  toggleInput2.checked = state.numericLens;
  toggleInput2.onchange = () => {
    state.numericLens = toggleInput2.checked;
    update();
  };
  const toggleSlider2 = createElement("span", "kiko-toggle-slider");
  toggleSwitch2.append(toggleInput2, toggleSlider2);
  toggleRow2.append(toggleLabel2, toggleSwitch2);
  outputSection.appendChild(toggleRow2);

  body.appendChild(outputSection);

  // JSON Preview
  body.querySelectorAll("input[type='text'], textarea").forEach((el) => {
    el.spellcheck = true;
  });
  body.appendChild(previewEl);
  update();

  // Apply button
  applyBtn.onclick = () => {
    if (!currentNode) return;
    currentNode.kikoState = cloneState(state);
    syncWidgets(currentNode, currentNode.kikoState);
    if (currentNode.graph?.setDirtyCanvas) currentNode.graph.setDirtyCanvas(true, true);
    closeBuilder();
  };

  // Close dropdowns on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".kiko-combo-input")) {
      document.querySelectorAll(".kiko-dropdown-menu.open").forEach((m) => m.classList.remove("open"));
    }
  });
}

function loadImageToCanvas(file, dropZone, canvas, ctx, preview) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const maxWidth = dropZone.clientWidth - 4;
      const maxHeight = 200;
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = (maxWidth / width) * height;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (maxHeight / height) * width;
        height = maxHeight;
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      dropZone.classList.add("has-image");
      preview.classList.add("visible");
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function getCanvasColorAt(e, canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor((e.clientX - rect.left) * scaleX);
  const y = Math.floor((e.clientY - rect.top) * scaleY);
  const pixel = ctx.getImageData(x, y, 1, 1).data;
  return (
    "#" +
    pixel[0].toString(16).padStart(2, "0") +
    pixel[1].toString(16).padStart(2, "0") +
    pixel[2].toString(16).padStart(2, "0")
  ).toUpperCase();
}

app.registerExtension({
  name: EXTENSION_ID,
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name === NODE_NAME) {
      attachBuilder(nodeType);
    }
  },
});
