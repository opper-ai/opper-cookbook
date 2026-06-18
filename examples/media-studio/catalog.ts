/**
 * Model catalog — the single declarative source the studio renders from.
 *
 * The whole UI (picker, advanced options, reference slots) is built from these
 * entries. Adding a model is a data edit; adding a whole modality later (video,
 * audio) is just new entries with a different `modality` plus a poller — the
 * studio shell does not change.
 *
 * Model ids and capabilities mirror what `/v3/images` expects. Two dimension
 * styles exist on Opper image models: "size" (pixel WxH, e.g. gpt-image) and
 * "aspect" (ratios like 16:9, e.g. imagen / pruna / grok).
 */

export type Dimension =
  | { kind: "size"; options: string[]; default: string }
  | { kind: "aspect"; options: string[]; default: string };

/** A control whose value is forwarded to the provider under `key` (in `parameters`). */
export type VideoControl<T> = { key: string; options: T[]; default: T };

export type VideoConfig = {
  inputKind: "t2v" | "i2v" | "both"; // text-, image-, or either-to-video
  requiresImage?: boolean; // Generate is gated until a source image is added
  referenceImages?: boolean; // subject/character reference images
  resolutions?: VideoControl<string>;
  aspectRatios?: VideoControl<string>;
  durations?: VideoControl<number>;
};

export type ModelEntry = {
  id: string;
  label: string;
  provider: string;
  modality: "image" | "video";
  blurb: string;
  approxCost: number; // USD per image, or per-second/flat for video — for the picker
  costUnit?: "image" | "second" | "clip"; // how approxCost reads (default: image)
  default?: boolean; // default *within its modality*
  // image
  dimension?: Dimension;
  qualities?: string[];
  qualityDefault?: string;
  // video
  video?: VideoConfig;
  // when a source/edit image is attached, route to this model id instead
  editModel?: string;
  supports: {
    referenceImages?: boolean; // style/subject refs (reference_images[])
    imageEdit?: boolean; // edit a source image (image)
    mask?: boolean; // inpaint mask (mask)
    n?: number; // max images per request
    seed?: boolean;
  };
  happyPath: Record<string, unknown>; // image: top-level options; video: the `parameters` object
};

export const CATALOG: ModelEntry[] = [
  {
    id: "openai/gpt-image-2",
    label: "GPT Image 2",
    provider: "OpenAI",
    modality: "image",
    blurb: "Most capable all-rounder — edits and references. (High quality is slow; medium is the sweet spot.)",
    approxCost: 0.034,
    default: true,
    dimension: { kind: "size", options: ["1024x1024", "1536x1024", "1024x1536"], default: "1024x1024" },
    qualities: ["low", "medium", "high"],
    qualityDefault: "medium",
    supports: { referenceImages: true, imageEdit: true, mask: true, n: 4 },
    happyPath: { size: "1024x1024", quality: "medium", n: 1 },
  },
  {
    id: "pruna/p-image",
    label: "Pruna P-Image",
    provider: "Pruna",
    modality: "image",
    blurb: "Sub-cent and near-instant. Add an image to edit it instead.",
    approxCost: 0.002,
    dimension: { kind: "aspect", options: ["1:1", "16:9", "9:16", "4:3", "3:4"], default: "1:1" },
    // Generation by default; routes to p-image-edit when you attach an image.
    editModel: "pruna/p-image-edit",
    supports: { n: 1, seed: true, imageEdit: true },
    happyPath: { aspect_ratio: "1:1", n: 1 },
  },
  {
    id: "gemini/imagen-4.0-generate-001",
    label: "Imagen 4",
    provider: "Google",
    modality: "image",
    blurb: "Clean photoreal images with crisp text rendering.",
    approxCost: 0.04,
    dimension: { kind: "aspect", options: ["1:1", "3:4", "4:3", "9:16", "16:9"], default: "1:1" },
    qualities: ["low", "medium", "high"],
    qualityDefault: "high",
    supports: { n: 4 },
    happyPath: { aspect_ratio: "1:1", quality: "high", n: 1 },
  },
  {
    id: "vertexai/gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash Image",
    provider: "Google",
    modality: "image",
    blurb: "Newest fast Gemini image — edits, references, crisp detail.",
    approxCost: 0.06,
    dimension: {
      kind: "aspect",
      options: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
      default: "1:1",
    },
    qualities: ["low", "medium", "high"],
    qualityDefault: "high",
    supports: { referenceImages: true, imageEdit: true, n: 1 },
    happyPath: { aspect_ratio: "1:1", quality: "high", n: 1 },
  },
  {
    id: "vertexai/gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    provider: "Google",
    modality: "image",
    blurb: "Native Gemini image gen — edits and references, conversational control.",
    approxCost: 0.03,
    dimension: {
      kind: "aspect",
      options: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
      default: "1:1",
    },
    supports: { referenceImages: true, imageEdit: true, n: 1 },
    happyPath: { aspect_ratio: "1:1", n: 1 },
  },
  {
    id: "xai/grok-imagine-image",
    label: "Grok Imagine",
    provider: "xAI",
    modality: "image",
    blurb: "Stylized and expressive. Many aspect ratios, edits and references.",
    approxCost: 0.02,
    dimension: {
      kind: "aspect",
      options: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
      default: "1:1",
    },
    qualities: ["low", "medium", "high"],
    qualityDefault: "high",
    supports: { referenceImages: true, imageEdit: true, n: 1 },
    happyPath: { aspect_ratio: "1:1", quality: "high", n: 1 },
  },
  {
    id: "deepinfra/black-forest-labs/FLUX-2-pro",
    label: "FLUX.2 Pro",
    provider: "Black Forest Labs",
    modality: "image",
    blurb: "FLUX flagship — striking detail and composition.",
    approxCost: 0.04,
    dimension: { kind: "size", options: ["1024x1024", "1344x768", "768x1344"], default: "1024x1024" },
    supports: { n: 1 },
    happyPath: { size: "1024x1024", n: 1 },
  },

  // ---- Video (async: POST /v3/videos → poll /v3/artifacts/{id}/status) ----
  // For video, happyPath is the `parameters` object; keys are provider-specific.
  {
    id: "alibaba:eu/happyhorse-1.0-t2v",
    label: "HappyHorse · Text→Video",
    provider: "Alibaba",
    modality: "video",
    blurb: "Default — text to video with audio. High quality, per-second pricing.",
    approxCost: 0.14,
    costUnit: "second",
    default: true,
    supports: {},
    video: {
      inputKind: "t2v",
      resolutions: { key: "resolution", options: ["720P", "1080P"], default: "720P" },
      durations: { key: "duration", options: [3, 5, 8, 10], default: 5 },
    },
    happyPath: { resolution: "720P", duration: 5 },
  },
  {
    id: "alibaba:eu/happyhorse-1.0-i2v",
    label: "HappyHorse · Image→Video",
    provider: "Alibaba",
    modality: "video",
    blurb: "Animate a still image into a clip with audio. Needs a source image.",
    approxCost: 0.14,
    costUnit: "second",
    supports: {},
    video: {
      inputKind: "i2v",
      requiresImage: true,
      resolutions: { key: "resolution", options: ["720P", "1080P"], default: "720P" },
      durations: { key: "duration", options: [3, 5, 8, 10], default: 5 },
    },
    happyPath: { resolution: "720P", duration: 5 },
  },
  {
    id: "xai/grok-imagine-video",
    label: "Grok Imagine Video",
    provider: "xAI",
    modality: "video",
    blurb: "Text or image to video, stylized. Flat rate per clip.",
    approxCost: 0.5,
    costUnit: "clip",
    supports: {},
    video: {
      inputKind: "both",
      resolutions: { key: "resolution", options: ["480p", "720p"], default: "720p" },
      aspectRatios: { key: "aspect_ratio", options: ["16:9", "9:16", "1:1"], default: "16:9" },
      durations: { key: "duration", options: [4, 5, 6, 8], default: 5 },
    },
    happyPath: { resolution: "720p", aspect_ratio: "16:9", duration: 5 },
  },
  {
    id: "pruna/wan-t2v",
    label: "Wan Text→Video",
    provider: "Pruna",
    modality: "video",
    blurb: "Cheap, flat-rate text-to-video for quick clips.",
    approxCost: 0.1,
    costUnit: "clip",
    supports: {},
    video: {
      inputKind: "t2v",
      resolutions: { key: "resolution", options: ["480p", "720p"], default: "480p" },
      aspectRatios: { key: "aspect_ratio", options: ["16:9", "9:16"], default: "16:9" },
    },
    happyPath: { resolution: "480p", aspect_ratio: "16:9" },
  },
  {
    id: "vertexai/veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast",
    provider: "Google",
    modality: "video",
    blurb: "Top-quality text/image-to-video with audio (may need Vertex access).",
    approxCost: 0.1,
    costUnit: "second",
    supports: {},
    video: {
      inputKind: "both",
      referenceImages: true,
      resolutions: { key: "resolution", options: ["720p", "1080p"], default: "720p" },
      aspectRatios: { key: "aspectRatio", options: ["16:9", "9:16"], default: "16:9" },
      durations: { key: "durationSeconds", options: [4, 6, 8], default: 4 },
    },
    happyPath: { resolution: "720p", aspectRatio: "16:9", durationSeconds: 4, generateAudio: true },
  },
];

export function defaultModel(modality: ModelEntry["modality"] = "image"): ModelEntry {
  const inModality = CATALOG.filter((m) => m.modality === modality);
  return inModality.find((m) => m.default) ?? inModality[0];
}
