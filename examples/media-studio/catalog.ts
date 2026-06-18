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

export type ModelEntry = {
  id: string;
  label: string;
  provider: string;
  modality: "image";
  blurb: string;
  approxCost: number; // USD per image, for the picker
  default?: boolean;
  dimension: Dimension;
  qualities?: string[];
  qualityDefault?: string;
  supports: {
    referenceImages?: boolean; // style/subject refs (reference_images[])
    imageEdit?: boolean; // edit a source image (image)
    mask?: boolean; // inpaint mask (mask)
    n?: number; // max images per request
    seed?: boolean;
  };
  happyPath: Record<string, unknown>;
};

export const CATALOG: ModelEntry[] = [
  {
    id: "openai/gpt-image-2",
    label: "GPT Image 2",
    provider: "OpenAI",
    modality: "image",
    blurb: "Most capable all-rounder. Strong prompt adherence, edits and references.",
    approxCost: 0.04,
    default: true,
    dimension: { kind: "size", options: ["1024x1024", "1536x1024", "1024x1536"], default: "1024x1024" },
    qualities: ["low", "medium", "high"],
    qualityDefault: "high",
    supports: { referenceImages: true, imageEdit: true, mask: true, n: 4 },
    happyPath: { size: "1024x1024", quality: "high", n: 1 },
  },
  {
    id: "pruna/p-image",
    label: "Pruna P-Image",
    provider: "Pruna",
    modality: "image",
    blurb: "Sub-cent and near-instant. Great for fast iteration.",
    approxCost: 0.002,
    dimension: { kind: "aspect", options: ["1:1", "16:9", "9:16", "4:3", "3:4"], default: "1:1" },
    supports: { n: 1, seed: true },
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
];

export function defaultModel(): ModelEntry {
  return CATALOG.find((m) => m.default) ?? CATALOG[0];
}
