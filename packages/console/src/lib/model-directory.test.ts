import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { isVisionModel } from "./model-directory.server.ts";

describe("isVisionModel", () => {
  test("flags vision / multimodal models", () => {
    for (const id of [
      "McG-221/gemma-3-12b-it-vl-Polaris-GLM-4.7-Flash-VAR-Thinking-Instruct-Heretic-Uncensored-mlx-8Bit",
      "mlx-community/Qwen2.5-VL-7B-Instruct-4bit",
      "mlx-community/llava-1.5-7b-4bit",
      "mlx-community/paligemma2-3b-mix-448-8bit",
      "OpenGVLab/InternVL2-8B",
      "mlx-community/SmolVLM-Instruct-4bit",
      "mlx-community/pixtral-12b-4bit",
    ]) {
      assert.equal(isVisionModel(id), true, id);
    }
  });

  test("does not flag text models (incl. our thinking models)", () => {
    for (const id of [
      "lmstudio-community/Qwen3-4B-Thinking-2507-MLX-4bit",
      "coderavi/Llama3.3-8B-Instruct-Thinking-Heretic-Uncensored-Claude-4.5-Opus-High-Reasoning-mlx-8Bit",
      "mlx-community/Qwen2.5-7B-Instruct-4bit",
      "mlx-community/Mistral-7B-Instruct-v0.3-4bit",
      "stub",
    ]) {
      assert.equal(isVisionModel(id), false, id);
    }
  });
});
