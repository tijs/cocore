// Recommended-models rotation — the server-side mirror of the provider
// Rust catalog's "recommended" set. The console and the menu-bar/tray
// app fetch `GET /v1/recommended-models` to render a curated picker
// WITHOUT shipping a new app release every time the rotation changes:
// the list has one home here and is served over HTTP.
//
// Each entry is the model id (an mlx-community HuggingFace repo id the
// provider engine knows how to load), the minimum host RAM in GiB we
// recommend before offering it, and a short human blurb for the picker.
//
// This is intentionally hardcoded for now but isolated to one module so
// a future env/remote override (e.g. COCORE_RECOMMENDED_MODELS pointing
// at a published record) has a single seam to slot into. Keep this in
// sync with the provider catalog's recommended rotation — the provider
// is the source of truth for what it can actually run; this list is the
// curated subset we surface to new hosts.

export interface RecommendedModel {
  /** HuggingFace repo id (mlx-community/...) honored by the provider. */
  id: string;
  /** Minimum host RAM (GiB) we recommend before offering this model. */
  minRamGb: number;
  /** Short human-facing description for the model picker. */
  blurb: string;
}

/** The canonical recommended rotation. Ordered smallest→largest so a
 *  picker can present them by host capability. Mirror of the provider
 *  Rust catalog's recommended set. */
export const RECOMMENDED_MODELS: readonly RecommendedModel[] = [
  {
    id: "mlx-community/Qwen3.5-0.8B-MLX-4bit",
    minRamGb: 4,
    blurb: "Qwen3.5 0.8B — fast, low quality; fits any Apple Silicon",
  },
  {
    id: "mlx-community/Qwen3.5-2B-MLX-4bit",
    minRamGb: 6,
    blurb: "Qwen3.5 2B — small but coherent; good on 8GB",
  },
  {
    id: "mlx-community/Qwen3.5-4B-MLX-4bit",
    minRamGb: 8,
    blurb: "Qwen3.5 4B — balanced default for 8GB+ Macs",
  },
  {
    id: "mlx-community/gemma-4-e4b-it-4bit",
    minRamGb: 8,
    blurb: "Gemma 4 E4B — efficient multimodal-class; 8GB+",
  },
  {
    id: "mlx-community/Qwen3.5-9B-MLX-4bit",
    minRamGb: 16,
    blurb: "Qwen3.5 9B — strong general-purpose; 16GB+ recommended",
  },
  {
    id: "mlx-community/Qwen3.6-27B-4bit",
    minRamGb: 24,
    blurb: "Qwen3.6 27B — frontier-class dense; 24GB+",
  },
  {
    id: "mlx-community/Qwen3.6-35B-A3B-4bit",
    minRamGb: 32,
    blurb: "Qwen3.6 35B-A3B MoE — fast for its size; 32GB+",
  },
  {
    id: "mlx-community/Llama-4-Scout-17B-16E-Instruct-4bit",
    minRamGb: 64,
    blurb: "Llama 4 Scout 17B×16E MoE — heavyweight; 64GB+",
  },
  {
    id: "mlx-community/Qwen3.5-122B-A10B-4bit",
    minRamGb: 96,
    blurb: "Qwen3.5 122B-A10B MoE — flagship; 96GB+ Mac Studio/Ultra",
  },
];

/** Set of recommended model ids for O(1) membership checks — used to
 *  flag entries in the broader model directory as recommended vs. a
 *  legacy/ad-hoc model some provider happens to advertise. */
export const RECOMMENDED_MODEL_IDS: ReadonlySet<string> = new Set(
  RECOMMENDED_MODELS.map((m) => m.id),
);
