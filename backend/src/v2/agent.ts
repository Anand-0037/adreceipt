import OpenAI from "openai";
import { INTENTS, TOPICS } from "./campaign";

export interface CampaignSuggestion {
  targetTopics: (typeof TOPICS)[number][];
  targetIntents: (typeof INTENTS)[number][];
  creativeHeadline: string;
  creativeBody: string;
  provider: "GroqCloud";
  model: string;
  requiresHumanApproval: true;
}

function bounded(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw new Error("MODEL_INVALID_RESPONSE");
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error(`MODEL_INVALID_${field}`);
  return result;
}

export async function suggestCampaign(args: {
  apiKey: string;
  model: string;
  baseUrl: string;
  brief: unknown;
  brandDisplayName: unknown;
  productRef: unknown;
}): Promise<CampaignSuggestion> {
  if (!args.apiKey) throw new Error("MODEL_UNAVAILABLE");
  const brief = bounded(args.brief, "BRIEF", 2_000);
  const brand = bounded(args.brandDisplayName, "BRAND", 120);
  const product = bounded(args.productRef, "PRODUCT", 500);
  const client = new OpenAI({
    apiKey: args.apiKey,
    baseURL: args.baseUrl,
    timeout: 20_000,
    maxRetries: 1,
  });
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["targetTopics", "targetIntents", "creativeHeadline", "creativeBody"],
    properties: {
      targetTopics: {
        type: "array",
        minItems: 1,
        items: { type: "string", enum: [...TOPICS] },
      },
      targetIntents: {
        type: "array",
        minItems: 1,
        items: { type: "string", enum: [...INTENTS] },
      },
      creativeHeadline: { type: "string", minLength: 1, maxLength: 120 },
      creativeBody: { type: "string", minLength: 1, maxLength: 300 },
    },
  } as const;
  const response = await client.chat.completions.create({
    model: args.model,
    messages: [
      {
        role: "system",
        content:
          "Compile the advertiser brief into a conservative AdReceipt campaign suggestion. Choose only the supplied enum values. Do not invent claims, prices, URLs, endorsements, or performance. The sponsored copy must clearly describe the supplied product and remain reviewable by the advertiser.",
      },
      {
        role: "user",
        content: JSON.stringify({ brandDisplayName: brand, productRef: product, brief }),
      },
    ],
    max_completion_tokens: 1_200,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "adreceipt_campaign_suggestion",
        strict: true,
        schema,
      },
    },
  });
  let parsed: Record<string, unknown>;
  try {
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("MODEL_EMPTY_RESPONSE");
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("MODEL_INVALID_RESPONSE");
  }
  const topics = Array.isArray(parsed.targetTopics) ? [...new Set(parsed.targetTopics)] : [];
  const intents = Array.isArray(parsed.targetIntents) ? [...new Set(parsed.targetIntents)] : [];
  if (
    topics.length === 0 ||
    topics.some((value) => !TOPICS.includes(value as (typeof TOPICS)[number])) ||
    intents.length === 0 ||
    intents.some((value) => !INTENTS.includes(value as (typeof INTENTS)[number]))
  ) {
    throw new Error("MODEL_INVALID_RESPONSE");
  }
  return {
    targetTopics: (topics as (typeof TOPICS)[number][]).sort(),
    targetIntents: (intents as (typeof INTENTS)[number][]).sort(),
    creativeHeadline: bounded(parsed.creativeHeadline, "HEADLINE", 120),
    creativeBody: bounded(parsed.creativeBody, "BODY", 300),
    provider: "GroqCloud",
    model: args.model,
    requiresHumanApproval: true,
  };
}
