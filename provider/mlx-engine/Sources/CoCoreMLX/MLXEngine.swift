// Native in-process MLX inference engine. The prompt is decrypted by the Rust
// agent and handed here; generation runs entirely inside this statically-linked
// code (no subprocess, no IPC), so the measured `cocore` binary covers it.
//
// Built on the upstream Apache-2.0 MLX-Swift stack (MLXLLM / MLXLMCommon) — the
// same libraries darkbloom's provider-swift uses, NOT their proprietary code.

import Foundation
import MLXLLM
import MLXLMCommon
import CryptoKit

public final class MLXEngine {
    private let container: ModelContainer
    public let metallibHash: String?

    private init(container: ModelContainer, metallibHash: String?) {
        self.container = container
        self.metallibHash = metallibHash
    }

    /// Load an MLX model (safetensors weights + tokenizer) from a local
    /// directory into this process. No network — the directory is the
    /// already-downloaded HF snapshot.
    public static func load(modelDir: String) async throws -> MLXEngine {
        let config = ModelConfiguration(directory: URL(fileURLWithPath: modelDir))
        let container = try await LLMModelFactory.shared.loadContainer(configuration: config)
        return MLXEngine(container: container, metallibHash: locateMetallibHash())
    }

    /// Stream a completion token-by-token through `onDelta`, in-process.
    /// Returns (promptTokenCount, generationTokenCount) for the receipt.
    public func generate(
        prompt: String, maxTokens: Int, onDelta: (String) -> Void
    ) async throws -> (Int, Int) {
        let params = GenerateParameters(maxTokens: maxTokens)
        var tokensIn = 0
        var tokensOut = 0
        let stream: AsyncStream<Generation> = try await container.perform {
            (context: ModelContext) in
            let input = try await context.processor.prepare(
                input: UserInput(chat: [.user(prompt)]))
            return try MLXLMCommon.generate(input: input, parameters: params, context: context)
        }
        for await item in stream {
            switch item {
            case .chunk(let text):
                onDelta(text)
            case .info(let info):
                tokensIn = info.promptTokenCount
                tokensOut = info.generationTokenCount
            case .toolCall:
                break
            }
        }
        return (tokensIn, tokensOut)
    }

    /// Locate the precompiled `mlx.metallib` the GPU kernels load and hash it
    /// (SHA-256 hex) so the attestation can pin it. Search order mirrors
    /// darkbloom's: env override, sibling of the executable, then any
    /// `*.metallib` bundled under the executable's directory tree.
    static func locateMetallibHash() -> String? {
        guard let url = locateMetallib() else { return nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func locateMetallib() -> URL? {
        let fm = FileManager.default
        if let env = ProcessInfo.processInfo.environment["MLX_METALLIB_PATH"],
            !env.isEmpty, fm.fileExists(atPath: env)
        {
            return URL(fileURLWithPath: env)
        }
        // Search directories in MLX's own load order: next to THIS dylib (the
        // image that contains the MLX code — found via #dsohandle, exactly how
        // MLX's device.cpp locates it), then next to the executable.
        var dirs: [URL] = []
        if let dy = currentDylibDir() { dirs.append(dy) }
        dirs.append(
            URL(fileURLWithPath: CommandLine.arguments.first ?? "")
                .resolvingSymlinksInPath().deletingLastPathComponent())
        for dir in dirs {
            for name in ["mlx.metallib", "default.metallib"] {
                let c = dir.appendingPathComponent(name)
                if fm.fileExists(atPath: c.path) { return c }
            }
            // Fall back to any *.metallib bundled under this directory tree
            // (SwiftPM/Xcode place Cmlx's metallib in a *.bundle).
            if let en = fm.enumerator(at: dir, includingPropertiesForKeys: nil) {
                for case let u as URL in en where u.pathExtension == "metallib" {
                    return u
                }
            }
        }
        return nil
    }

    /// Directory containing THIS dylib, via `dladdr(#dsohandle)`.
    private static func currentDylibDir() -> URL? {
        var info = Dl_info()
        guard dladdr(#dsohandle, &info) != 0, let fname = info.dli_fname else { return nil }
        return URL(fileURLWithPath: String(cString: fname)).deletingLastPathComponent()
    }
}
