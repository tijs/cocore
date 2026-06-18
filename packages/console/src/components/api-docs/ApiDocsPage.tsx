"use client";

// Public API documentation. Linked from the footer, the in-/account
// "Show usage example" affordance, and any external docs that want
// a stable URL. Mirrors the OpenAI chat-completions surface 1:1 with
// `base_url=https://console.cocore.dev/api/v1` — anyone with an
// existing OpenAI SDK can swap two strings (base URL + key) and
// they're calling cocore.

import * as stylex from "@stylexjs/stylex";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, createLink } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { modelDirectoryQueryOptions } from "@/components/api-docs/models.functions.ts";

import { highlightCodeQueryOptions } from "@/components/account/account.functions.ts";
import {
  type SnippetLang,
  SNIPPET_LANGS,
  SNIPPET_LANG_LABELS,
  SNIPPET_LANG_TO_SHIKI,
  buildSnippet,
} from "@/components/api-docs/snippets.ts";
import { CreateApiKeyButton } from "@/components/api-keys/CreateApiKeyButton.tsx";
import { Button } from "@/design-system/button";
import { getSessionQueryOptions } from "@/integrations/auth/session.functions.ts";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/design-system/card";
import { CopyToClipboardButton } from "@/design-system/copy-to-clipboard-button";
import { Flex } from "@/design-system/flex";
import { Page } from "@/design-system/page/index.tsx";
import { SegmentedControl, SegmentedControlItem } from "@/design-system/segmented-control";
import { Select, SelectItem } from "@/design-system/select";
import { fontFamily, fontSize, fontWeight } from "@/design-system/theme/typography.stylex";
import { uiColor } from "@/design-system/theme/color.stylex";
import { verticalSpace } from "@/design-system/theme/semantic-spacing.stylex";
import { Body, Heading1, InlineCode, SmallBody } from "@/design-system/typography";

const styles = stylex.create({
  headingMono: {
    fontFamily: fontFamily.mono,
  },
  cardTitleMono: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: uiColor.text2,
    textTransform: "lowercase",
  },
  cardDescription: {
    fontSize: fontSize.xs,
    color: uiColor.text1,
    fontWeight: fontWeight.normal,
  },
  sections: {
    display: "flex",
    flexDirection: "column",
    gap: verticalSpace["2xl"],
  },
  usage: {
    fontFamily: fontFamily.mono,
    fontSize: "0.8125rem",
    whiteSpace: "pre",
    overflowX: "auto",
    padding: "1rem 1.25rem",
    borderColor: uiColor.component3,
    borderRadius: "0.5rem",
    borderStyle: "solid",
    borderWidth: 1,
    background: "rgba(0,0,0,0.05)",
    marginTop: verticalSpace["2xl"],
    marginBottom: verticalSpace["2xl"],
    marginLeft: 0,
    marginRight: 0,
  },
  highlightedSnippet: {
    flexGrow: 1,
    minWidth: 0,
    borderColor: uiColor.border1,
    borderRadius: "0.5rem",
    borderStyle: "solid",
    borderWidth: 1,
    overflow: "hidden",
    marginTop: verticalSpace["2xl"],
    marginBottom: verticalSpace["2xl"],
  },
  snippetWrapper: {},
  modelSelect: {
    width: "fit-content",
    minWidth: 240,
    maxWidth: "100%",
  },
  modelHint: {
    marginTop: verticalSpace["md"],
  },
  list: {
    margin: "0.5rem 0 0",
    paddingLeft: "1.25rem",
    fontFamily: fontFamily.sans,
    fontSize: "0.95rem",
    lineHeight: 1.55,
  },
  bullet: {
    marginBottom: "0.4rem",
  },
  bodySpaced: {
    marginTop: "0.5rem",
  },
});

const ButtonLink = createLink(Button);

const DEFAULT_BASE_URL = "https://console.cocore.dev/api/v1";

export function ApiDocsPage() {
  const baseUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/v1` : DEFAULT_BASE_URL;
  const [lang, setLang] = useState<SnippetLang>("typescript");
  const [model, setModel] = useState<string>("stub");

  const directory = useQuery(modelDirectoryQueryOptions);

  // Directory drives the Quickstart model picker. We always keep
  // "stub" as a guaranteed option so the snippet has a sensible
  // default while the directory is loading, empty, or unreachable.
  const modelItems = useMemo<Array<{ id: string; label: string }>>(() => {
    const items = (directory.data?.models ?? []).map((m) => ({
      id: m.modelId,
      label:
        m.machineCount > 0
          ? `${m.modelId} — ${m.machineCount} ${m.machineCount === 1 ? "machine" : "machines"}`
          : m.modelId,
    }));
    if (!items.some((i) => i.id === "stub")) {
      items.push({ id: "stub", label: "stub (test model)" });
    }
    return items;
  }, [directory.data]);

  const snippets = useMemo<Record<SnippetLang, string>>(() => {
    const out = {} as Record<SnippetLang, string>;
    for (const l of SNIPPET_LANGS) out[l] = buildSnippet(l, baseUrl, model);
    return out;
  }, [baseUrl, model]);

  const highlights = useQueries({
    queries: SNIPPET_LANGS.map((l) => ({
      ...highlightCodeQueryOptions({
        code: snippets[l],
        lang: SNIPPET_LANG_TO_SHIKI[l] as
          | "python"
          | "typescript"
          | "java"
          | "go"
          | "csharp"
          | "bash"
          | "json",
      }),
    })),
  });
  const snippet = snippets[lang];
  const highlighted = highlights[SNIPPET_LANGS.indexOf(lang)]?.data;

  return (
    <Page.Root>
      <Page.Header>
        <Flex direction="column" gap="5xl">
          <Heading1 style={styles.headingMono}>api</Heading1>
          <Page.Description>
            OpenAI-compatible chat completions. Point any OpenAI SDK at{" "}
            <InlineCode>{baseUrl}</InlineCode> and use a cocore API key in place of your OpenAI key
            — every request is dispatched through the co/core exchange to a paired provider.
          </Page.Description>
        </Flex>
      </Page.Header>

      <div {...stylex.props(styles.sections)}>
        <Card size="md">
          <CardHeader hasBorder>
            <CardTitle style={styles.cardTitleMono}>Authentication</CardTitle>
            <CardDescription style={styles.cardDescription}>
              Bearer-key auth, OpenAI-shaped headers.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <Body>
              Pass your key in the <InlineCode>Authorization</InlineCode> header. Keys are shown
              once at creation.
            </Body>
            <HighlightedBlock code="Authorization: Bearer cocore-..." lang="bash" />
            <Flex direction="row" gap="md">
              <CreateApiKeyOrLoginButton />
            </Flex>
          </CardBody>
        </Card>

        <Card size="md">
          <CardHeader hasBorder>
            <CardTitle style={styles.cardTitleMono}>Endpoint</CardTitle>
            <CardDescription style={styles.cardDescription}>
              POST /chat/completions — same path + body shape as OpenAI.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <Body>
              Base URL: <InlineCode>{baseUrl}</InlineCode>
            </Body>
            <Body style={styles.bodySpaced}>Request body (subset of OpenAI's):</Body>
            <HighlightedBlock
              lang="json"
              code={`{
  "model": "stub",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true,
  "max_tokens": 1024
}`}
            />
            <Body style={styles.bodySpaced}>
              Streaming responses are OpenAI-shaped <InlineCode>text/event-stream</InlineCode>;
              non-streaming returns a single <InlineCode>chat.completion</InlineCode>.
            </Body>
          </CardBody>
        </Card>

        <Card size="md">
          <CardHeader hasBorder>
            <CardTitle style={styles.cardTitleMono}>Models directory</CardTitle>
            <CardDescription style={styles.cardDescription}>
              GET /models — what's being served, and by how many machines. No auth.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <Body>
              A public, unauthenticated list of every model at least one attested provider is
              serving right now — with the number of machines serving each and the price per million
              tokens.
            </Body>
            <Body style={styles.bodySpaced}>
              <InlineCode>GET {baseUrl}/models</InlineCode> returns full per-machine detail +
              activity; add <InlineCode>?view=summary</InlineCode> for the lean shape:
            </Body>
            <HighlightedBlock
              lang="json"
              code={`// GET ${baseUrl}/models?view=summary
{
  "models": [
    {
      "modelId": "mlx-community/Qwen2.5-7B-Instruct-4bit",
      "machineCount": 3,
      "inputPricePerMTok": 0,
      "outputPricePerMTok": 0,
      "currency": "CC"
    }
  ],
  "generatedAt": "2026-06-11T18:00:00.000Z",
  "appviewUnreachable": false
}`}
            />
          </CardBody>
        </Card>

        <Card size="md">
          <CardHeader hasBorder>
            <CardTitle style={styles.cardTitleMono}>OpenAPI spec</CardTitle>
            <CardDescription style={styles.cardDescription}>
              The whole public API as a machine-readable schema.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <Body>
              An OpenAPI 3.1 description of these endpoints lives at{" "}
              <a href="/openapi.yaml">
                <InlineCode>/openapi.yaml</InlineCode>
              </a>
              . Import it into Postman, Insomnia, or any client generator to scaffold a typed SDK.
            </Body>
          </CardBody>
        </Card>

        <Card size="md">
          <CardHeader hasBorder>
            <CardTitle style={styles.cardTitleMono}>Friends-only endpoint</CardTitle>
            <CardDescription style={styles.cardDescription}>
              POST /private/chat/completions — narrows routing to DIDs you trust.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <Body>
              Identical request + response shape to the open endpoint above. The only difference:
              the request is constrained to providers run by DIDs you've friended on{" "}
              <a href="/friends">/friends</a>. If none of your friends are online, or none serve the
              requested model, the response is a structured error (
              <InlineCode>no_friends_available</InlineCode> /{" "}
              <InlineCode>no_friends_for_model</InlineCode>) rather than a fallthrough to a random
              attested provider.
            </Body>
            <Body style={styles.bodySpaced}>
              Base URL: <InlineCode>{baseUrl}/private</InlineCode>
            </Body>
            <Body style={styles.bodySpaced}>
              Use this for prompts you'd rather not see executed on an arbitrary stranger's attested
              Mac — the same X25519 + NaCl crypto wraps the prompt either way; the difference is
              which set of strangers' Macs are in the candidate pool.
            </Body>
          </CardBody>
        </Card>

        <Card size="md">
          <CardHeader hasBorder>
            <CardTitle style={styles.cardTitleMono}>Error codes</CardTitle>
            <CardDescription style={styles.cardDescription}>
              Stable codes you can switch on when the dispatch can't find a provider.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <Body>
              When pickFor on the advisor can't match a provider, the response is shaped like
              OpenAI's error envelope (
              <InlineCode>{`{ error: { type, code, message } }`}</InlineCode>) with a
              cocore-specific <InlineCode>code</InlineCode> string. Codes are stable — client logic
              can pattern-match on them.
            </Body>
            <HighlightedBlock
              lang="json"
              code={`// 404 — the requested model isn't loaded by anyone on the network
{ "error": { "type": "invalid_request_error", "code": "model_not_found", "message": "..." } }

// 503 — no providers are connected to the advisor at all
{ "error": { "type": "service_unavailable_error", "code": "no_providers_connected", "message": "..." } }

// 503 — friends-only endpoint, but none of your friends are online
{ "error": { "type": "service_unavailable_error", "code": "no_friends_available", "message": "..." } }

// 404 — friends-only endpoint, friends are online but none serve this model
{ "error": { "type": "invalid_request_error", "code": "no_friends_for_model", "message": "..." } }`}
            />
          </CardBody>
        </Card>

        <Card size="md">
          <CardHeader hasBorder>
            <CardTitle style={styles.cardTitleMono}>Quickstart</CardTitle>
            <CardDescription style={styles.cardDescription}>
              Drop-in OpenAI replacement: change two strings in your existing code.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <Flex direction="column" gap="2xl" style={styles.snippetWrapper}>
              <Select
                label="Model"
                size="lg"
                items={modelItems}
                value={model}
                style={styles.modelSelect}
                onChange={(key) => {
                  if (typeof key === "string") setModel(key);
                }}
              >
                {(item) => <SelectItem>{item.label}</SelectItem>}
              </Select>
              <SmallBody style={styles.modelHint}>
                {directory.isLoading ? (
                  "Loading the live model directory…"
                ) : directory.isError || !directory.data ? (
                  "Could not reach the live model directory — falling back to the test model."
                ) : modelItems.length <= 1 ? (
                  "No attested providers are online right now — only the test model is available."
                ) : (
                  <>
                    Pricing is uniform across every model and runs 1:1 against model tokens. Every
                    receipt costs <InlineCode>tokens.in + tokens.out</InlineCode> from your balance;
                    95% goes to the provider and 5% to the cooperative&apos;s treasury, which
                    redistributes monthly as a patronage rebate. New members get 1,000,000 tokens on
                    signup; active members get a weekly refresh. See the{" "}
                    <a
                      href="/lexicons/dev.cocore.compute.exchangePolicy"
                      target="_blank"
                      rel="noreferrer"
                    >
                      exchangePolicy
                    </a>{" "}
                    for the canonical parameters.
                  </>
                )}
              </SmallBody>
              <SegmentedControl
                aria-label="Snippet language"
                size="sm"
                selectedKeys={new Set([lang])}
                onSelectionChange={(selection) => {
                  const id = selection.values().next().value;
                  if (typeof id !== "string") return;
                  if ((SNIPPET_LANGS as readonly string[]).includes(id)) {
                    setLang(id as SnippetLang);
                  }
                }}
              >
                {SNIPPET_LANGS.map((id) => (
                  <SegmentedControlItem key={id} id={id}>
                    {SNIPPET_LANG_LABELS[id]}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
              <Flex direction="row" align="start" gap="sm">
                {highlighted ? (
                  <div
                    {...stylex.props(styles.highlightedSnippet)}
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                  />
                ) : (
                  <pre {...stylex.props(styles.usage)}>{snippet}</pre>
                )}
                <CopyToClipboardButton text={snippet} />
              </Flex>
            </Flex>
          </CardBody>
        </Card>

        <Card size="md">
          <CardHeader hasBorder>
            <CardTitle style={styles.cardTitleMono}>Errors</CardTitle>
            <CardDescription style={styles.cardDescription}>
              OpenAI-shaped error envelope.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <HighlightedBlock
              lang="json"
              code={`{
  "error": {
    "message": "Missing Authorization: Bearer header",
    "type": "authentication_error",
    "code": null,
    "param": null
  }
}`}
            />
            <ul {...stylex.props(styles.list)}>
              <li {...stylex.props(styles.bullet)}>
                <InlineCode>401 authentication_error</InlineCode> — missing or invalid API key. Mint
                a fresh one at{" "}
                <Link preload={false} to="/account">
                  /account
                </Link>
                .
              </li>
              <li {...stylex.props(styles.bullet)}>
                <InlineCode>400 invalid_request_error</InlineCode> — malformed body (missing model /
                messages / etc.).
              </li>
              <li {...stylex.props(styles.bullet)}>
                <InlineCode>502 server_error</InlineCode> — upstream provider disconnected
                mid-stream. Retry usually works.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </Page.Root>
  );
}

/** Auth-gated trigger for the Authentication card.
 *
 *  This page is public, so we can't assume the user is signed in. If
 *  they are, render the real `CreateApiKeyButton` (which opens the
 *  reveal-once dialog flow on the account page). If they aren't,
 *  render a `Log in to create a key` link that bounces through the
 *  login page with a `redirect=/api-docs` so they land back here
 *  after auth and can mint a key on the second click. While the
 *  session query is in flight we render a disabled, pending button
 *  so the layout doesn't shift. */
function CreateApiKeyOrLoginButton() {
  const { data: session, isPending } = useQuery(getSessionQueryOptions);

  if (isPending) {
    return (
      <Button size="sm" variant="primary" isDisabled isPending>
        Create API key
      </Button>
    );
  }

  if (session?.user) {
    return <CreateApiKeyButton size="sm" label="Create API key" />;
  }

  return (
    <ButtonLink to="/login" search={{ redirect: "/api-docs" }} variant="primary" size="sm">
      Log in to create a key
    </ButtonLink>
  );
}

/** Renders a small static code snippet via the same Shiki pipeline
 *  used by the Quickstart `useQueries` block. Falls back to a plain
 *  `<pre>` while the highlight query is in flight (or on error) so
 *  the page never goes blank. */
function HighlightedBlock({ code, lang }: { code: string; lang: "json" | "bash" }) {
  const { data } = useQuery(highlightCodeQueryOptions({ code, lang }));
  if (data) {
    return (
      <div
        {...stylex.props(styles.highlightedSnippet)}
        dangerouslySetInnerHTML={{ __html: data }}
      />
    );
  }
  return <pre {...stylex.props(styles.usage)}>{code}</pre>;
}
