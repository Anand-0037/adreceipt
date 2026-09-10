import OpenAI from "openai";

export interface OrganicAnswer {
  text: string;
  provider: "GroqCloud";
  model: string;
  storedByApplication: false;
}

export async function createOrganicAnswer(args: {
  apiKey: string;
  model: string;
  baseUrl: string;
  query: unknown;
}): Promise<OrganicAnswer> {
  if (!args.apiKey) throw new Error("MODEL_UNAVAILABLE");
  if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 2_000) {
    throw new Error("query must be 1-2000 characters");
  }
  const client = new OpenAI({
    apiKey: args.apiKey,
    baseURL: args.baseUrl,
    timeout: 15_000,
    maxRetries: 1,
  });
  const response = await client.responses.create({
    model: args.model,
    store: false,
    instructions:
      "Answer the user's question directly and concisely. Do not mention advertising, sponsors, campaigns, AdReceipt, or products supplied by an advertising system. Do not claim to have used tools or current web data. Keep the organic answer independent from any paid placement.",
    input: args.query.trim(),
    max_output_tokens: 260,
  });
  const answer = response.output_text.trim();
  if (!answer) throw new Error("MODEL_EMPTY_RESPONSE");
  return {
    text: answer,
    provider: "GroqCloud",
    model: args.model,
    storedByApplication: false,
  };
}
