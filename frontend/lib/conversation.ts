"use client";

import type { ContextDecisionV2 } from "./api";

/**
 * The current conversation, shared between the user's page and the publisher's.
 *
 * /ask is where a person asks and reads; /publisher is where the publisher
 * runs the verification for whatever was asked. They are different pages for
 * different audiences, and the only thing that joins them is this record. It
 * lives in localStorage rather than sessionStorage so the two can be open in
 * separate tabs - the natural way to demo one screen driving the other.
 *
 * A `storage` event fires in every *other* tab when this changes, which is how
 * the publisher console notices a new question without polling.
 */

export const CONVERSATION_KEY = "adreceipt:v2:conversation";

export interface Conversation {
  query: string;
  decision: ContextDecisionV2;
  answer?: { text: string; provider: string; model: string };
  answerError?: string;
  askedAt: number;
}

export function saveConversation(value: Conversation): void {
  try {
    localStorage.setItem(CONVERSATION_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the page still works, the other tab just will not follow.
  }
}

export function loadConversation(): Conversation | null {
  try {
    const raw = localStorage.getItem(CONVERSATION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Conversation>;
    if (typeof value.query !== "string" || typeof value.decision?.decisionId !== "string") {
      return null;
    }
    return value as Conversation;
  } catch {
    return null;
  }
}

export function clearConversation(): void {
  try {
    localStorage.removeItem(CONVERSATION_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Where the publisher's progress on this decision is stored, by decision. */
export function placementKey(decisionId: string): string {
  return `adreceipt:v2:placement:${decisionId}`;
}

/** Subscribe to changes made in other tabs. Returns an unsubscribe function. */
export function onConversationChange(listener: () => void): () => void {
  const handler = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === CONVERSATION_KEY ||
      event.key.startsWith("adreceipt:v2:placement:")
    ) {
      listener();
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
