"use client";

import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { Button } from "@/design-system/button";
import { Flex } from "@/design-system/flex";
import { TextField } from "@/design-system/text-field";
import { fontFamily } from "@/design-system/theme/typography.stylex";
import { Body } from "@/design-system/typography";

const styles = stylex.create({
  codeInput: {
    fontFamily: fontFamily.mono,
    fontSize: "1.5rem",
    letterSpacing: "0.2em",
    width: "12ch",
  },
});

interface Props {
  initialCode: string;
}

type Status = "idle" | "approving" | "approved" | "denying" | "denied" | "error";

export function PairConfirm({ initialCode }: Props) {
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function approve() {
    setStatus("approving");
    setErrMsg(null);
    try {
      // The session (scoped API key) is minted server-side on approve; the
      // browser only asserts the user_code + decision.
      const res = await fetch("/api/xrpc/dev.cocore.devicePair.confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode: code, decision: "approve" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `${res.status}`);
      }
      setStatus("approved");
    } catch (e) {
      setStatus("error");
      setErrMsg((e as Error).message);
    }
  }

  async function deny() {
    setStatus("denying");
    setErrMsg(null);
    try {
      await fetch("/api/xrpc/dev.cocore.devicePair.confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode: code, decision: "deny" }),
      });
      setStatus("denied");
    } catch (e) {
      setStatus("error");
      setErrMsg((e as Error).message);
    }
  }

  if (status === "approved") {
    return (
      <Body>Approved. You can close this tab; the provider agent will pick up the session.</Body>
    );
  }
  if (status === "denied") {
    return <Body>Denied. The provider agent will stop polling.</Body>;
  }

  return (
    <Flex direction="column" gap="xl">
      <TextField
        label="Code"
        value={code}
        onChange={(value) => setCode(value.toUpperCase())}
        maxLength={8}
        size="lg"
        inputStyle={styles.codeInput}
        validationState={errMsg ? "invalid" : undefined}
        errorMessage={errMsg ? `Error: ${errMsg}` : undefined}
      />
      <Flex direction="row" gap="md" wrap>
        <Button onPress={approve} isDisabled={status === "approving" || code.length !== 8}>
          Approve
        </Button>
        <Button
          variant="secondary"
          onPress={deny}
          isDisabled={status === "denying" || code.length !== 8}
        >
          Deny
        </Button>
      </Flex>
    </Flex>
  );
}
