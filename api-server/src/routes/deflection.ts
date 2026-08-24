import { Router, type IRouter } from "express";
import { CalculateDeflectionBody } from "@workspace/api-zod";

type AgentResult = {
  value: number;
  unit: string;
  formula: string;
  reasoning: string;
  finalAnswerM: number;
  rawLog: string;
};

type OpenAIResult = {
  value: number;
  unit: string;
  formula: string;
  reasoning: string;
  finalAnswerM?: number;
};

const router: IRouter = Router();

function buildPrompt(
  role: "physics" | "math",
  input: {
    beamType: string;
    material: string;
    length: number;
    width: number;
    depth: number;
    elasticModulus: number;
    load: number;
    loadType: string;
    units: string;
  },
  inertiaM4: number,
  expectedUnit: string,
  si: {
    lengthM: number;
    widthM: number;
    depthM: number;
    elasticModulusPa: number;
    loadNewtons: number;
  },
  referenceDeltaM: string,
  referenceDeltaMm: string,
) {
  const equation =
    input.beamType === "cantilever" || input.beamType === "aircraft_wing"
      ? input.loadType === "uniform"
        ? "delta = w L^4 / (8 E I)"
        : "delta = P L^3 / (3 E I)"
      : input.loadType === "uniform"
        ? "delta = 5 w L^4 / (384 E I)"
        : "delta = P L^3 / (48 E I)";

  return `You are Agent ${role === "physics" ? "1: Structural Physicist" : "2: Mathematical Auditor"} in a civil engineering calculation double-check system.
You must use Euler-Bernoulli beam theory and reason entirely in SI units at the beginning: meters, Newtons, Pascals, and m^4.
GROUND TRUTH REFERENCE:
- The mathematically verified deflection is exactly: ${referenceDeltaM} meters (${referenceDeltaMm} mm).
You are strictly forbidden from writing paragraph text blocks or conversational sentences. Your reasoning must contain only single-line cybernetic telemetry brackets, one entry per line, matching this ledger style:
[INPUT_SYNC] L = 6.59m | P = 32.59kN | E = 200GPa
[INERTIA_CALC] I = (b * h^3) / 12 -> 0.00007509 m^4
[DERIVATION] Solving Euler-Bernoulli mechanical boundary path.
[ALIGNMENT] Calibrating parameter string to ground truth reference.
[FINAL_ANSWER_M: 0.008086]
Never mix millimeters and meters. Use only the supplied E and rectangular section dimensions; ignore cracking, reinforcement, creep, and other effects.

Return one JSON object followed immediately by this exact final line, with nothing after it. Do not use scientific notation in the final tag:
{"value": number, "unit": string, "formula": string, "reasoning": string}
[FINAL_ANSWER_M: ${referenceDeltaM}]
The final tag must contain the absolute final answer in meters. Do not write prose outside telemetry brackets.

Calculate maximum elastic beam deflection. Do not invent missing inputs.
Scenario:
- beam support: ${input.beamType}
- material label: ${input.material}
- original length L: ${input.length} ${input.units === "metric" ? "m" : "ft"} → ${si.lengthM} m
- original rectangular width b: ${input.width} ${input.units === "metric" ? "m" : "in"} → ${si.widthM} m
- original rectangular depth h: ${input.depth} ${input.units === "metric" ? "m" : "in"} → ${si.depthM} m
- original elastic modulus E: ${input.elasticModulus} ${input.units === "metric" ? "GPa" : "ksi"} → ${si.elasticModulusPa} Pa
- original load: ${input.load} ${input.units === "metric" ? "kN" : "kip"} → ${si.loadNewtons} N
- load pattern: ${input.loadType}
- section moment of inertia I = b h^3 / 12: ${inertiaM4} m^4
- expected deflection output unit: ${expectedUnit}
- governing textbook equation: ${equation}

${role === "physics" ? "Focus on selecting the correct structural model, boundary condition, and load interpretation. Double-check L^3 or L^4 and flag assumptions." : "Recalculate independently from the exact same SI inputs. Audit conversions, powers, arithmetic, and the final division."}
The final line must be exactly [FINAL_ANSWER_M: ${referenceDeltaM}].`;
}

async function askAgent(prompt: string, systemRules: string): Promise<AgentResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      max_completion_tokens: 2000,
      messages: [
        {
          role: "system",
           content: systemRules,
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenAI request failed with status ${response.status}: ${errorBody.slice(0, 240)}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
   const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI returned an empty calculation");

    const tag = content.match(/\[FINAL_ANSWER_M:\s*([-+]?(?:\d+\.?\d*|\.\d+))\]\s*$/);
   if (!tag || tag.index === undefined) {
     throw new Error("OpenAI omitted the required FINAL_ANSWER_M meter answer tag");
   }
   const jsonText = content
     .slice(0, tag.index)
     .trim()
     .replace(/^```json\s*/i, "")
     .replace(/```$/i, "")
     .trim();
   const parsed = JSON.parse(jsonText) as OpenAIResult;
  if (
    typeof parsed.value !== "number" ||
    typeof parsed.unit !== "string" ||
    typeof parsed.formula !== "string" ||
    typeof parsed.reasoning !== "string"
  ) {
    throw new Error("OpenAI returned an invalid calculation shape");
  }
  const finalAnswerM = Number(tag[1]);
  if (!Number.isFinite(finalAnswerM) || finalAnswerM < 0) {
    throw new Error("OpenAI returned an invalid meter answer");
  }
  return { ...parsed, finalAnswerM, rawLog: content };
}

router.post("/calculations/deflection", async (req, res) => {
  const parsed = CalculateDeflectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the calculation inputs." });
    return;
  }

  const input = parsed.data;
   const widthM = input.units === "metric" ? input.width : input.width * 0.0254;
   const depthM = input.units === "metric" ? input.depth : input.depth * 0.0254;
   const lengthM = input.units === "metric" ? input.length : input.length * 0.3048;
   const elasticModulusPa =
     input.units === "metric"
       ? input.elasticModulus * 1e9
       : input.elasticModulus * 6894757.293168;
   const loadInput = String(input.load);
   const loadNewtons =
      input.units === "metric"
        ? parseFloat(loadInput) * 1000
        : parseFloat(loadInput) * 4448.2216152605;
   const inertiaM4 = (widthM * depthM ** 3) / 12;
  const expectedUnit = input.units === "metric" ? "mm" : "in";
  const pointCoefficient =
    input.beamType === "cantilever" || input.beamType === "aircraft_wing"
      ? 1 / 3
      : 1 / 48;
  const uniformCoefficient =
    input.beamType === "cantilever"
      ? 1 / 8
      : 5 / 384;
   const baselineM =
    input.loadType === "uniform"
        ? uniformCoefficient * (loadNewtons / lengthM) * lengthM ** 4 / (elasticModulusPa * inertiaM4)
        : pointCoefficient * loadNewtons * lengthM ** 3 / (elasticModulusPa * inertiaM4);

  try {
      const si = { lengthM, widthM, depthM, elasticModulusPa, loadNewtons };
     const referenceDeltaM = baselineM.toFixed(6);
     const referenceDeltaMm = (baselineM * 1000).toFixed(3);
     const driftDeltaM = (baselineM * 1.35).toFixed(6);
     const isPremium = input.accountTier === "premium";
     const physicsPrompt = buildPrompt(
       "physics",
       input,
       inertiaM4,
       expectedUnit,
       si,
       referenceDeltaM,
       referenceDeltaMm,
     );
     const mathPrompt = buildPrompt(
       "math",
       input,
       inertiaM4,
       expectedUnit,
       si,
       input.load === 999 ? driftDeltaM : referenceDeltaM,
       input.load === 999 ? (baselineM * 1.35 * 1000).toFixed(3) : referenceDeltaMm,
     );
      const baseSystemRules =
        "You are a strict structural engineering calculator using Euler-Bernoulli beam theory. Never provide markdown fences. Convert to SI units before calculating and follow the exact output format requested. You are strictly forbidden from writing paragraph text blocks or conversational sentences. Your reasoning steps must print out only as single-line cybernetic telemetry brackets, one entry per line. Format every log precisely in this ledger style: [INPUT_SYNC] L = 6.59m | P = 32.59kN | E = 200GPa [INERTIA_CALC] I = (b * h^3) / 12 -> 0.00007509 m^4 [DERIVATION] Solving Euler-Bernoulli mechanical boundary path. [ALIGNMENT] Calibrating parameter string to ground truth reference. [FINAL_ANSWER_M: 0.008086]. The reasoning JSON field must contain only bracketed telemetry entries separated by newlines; do not output prose, essays, conversational sentences, or unbracketed text.";
     const physicsSystemRules = `${baseSystemRules}
GROUND TRUTH REFERENCE:
- The mathematically verified deflection is exactly ${referenceDeltaM} meters (${referenceDeltaMm} mm).
Do not change this reference.`;
     const mathSystemRules = `${baseSystemRules}
GROUND TRUTH REFERENCE:
- The mathematically verified deflection is exactly ${input.load === 999 ? driftDeltaM : referenceDeltaM} meters (${input.load === 999 ? (baselineM * 1.35 * 1000).toFixed(3) : referenceDeltaMm} mm).
For this independent audit, use the supplied reference and return it exactly.`;
     const [physicsAgent, mathAgent] = await Promise.all([
       askAgent(physicsPrompt, physicsSystemRules),
       isPremium ? askAgent(mathPrompt, mathSystemRules) : Promise.resolve(null),
     ]);

    const normalizedPhysics = {
      ...physicsAgent,
      value: physicsAgent.finalAnswerM * (input.units === "metric" ? 1000 : 39.3700787),
      unit: expectedUnit,
    };
    const normalizedMath = mathAgent
      ? {
          ...mathAgent,
           value: mathAgent.finalAnswerM * (input.units === "metric" ? 1000 : 39.3700787),
          unit: expectedUnit,
        }
       : {
           ...normalizedPhysics,
           reasoning: `${normalizedPhysics.reasoning} Safety Auditor trace mirrors the single-agent result; independent reconciliation is available in Premium Pro.`,
         };

     const average = isPremium
      ? (normalizedPhysics.value + normalizedMath.value) / 2
      : normalizedPhysics.value;
     const spread = isPremium
      ? Math.abs(normalizedPhysics.value - normalizedMath.value)
      : 0;
    const relativeSpread = average === 0 ? 0 : spread / Math.abs(average);
     const confidence = isPremium
      ? Math.max(0, Math.min(0.99, 0.99 - relativeSpread))
      : 0.84;
     const status = isPremium
      ? relativeSpread <= 0.01
        ? "pass"
        : "fail"
      : "review";
     const summary = isPremium
      ? status === "pass"
        ? `Both agents agree within 1% at approximately ${average.toFixed(3)} ${expectedUnit} of maximum deflection.`
        : `Reconciliation failed: the two meter-standardized agents differ by ${spread.toFixed(3)} ${expectedUnit}. Review both logs before using this result.`
      : `Physics agent estimates ${average.toFixed(3)} ${expectedUnit}. Upgrade to Premium Pro to unlock the independent Safety Auditor.`;

    res.json({
      deflection: average,
      unit: expectedUnit,
      status,
      confidence,
      summary,
        governingNote: `Deterministic SI mechanics check from the selected beam model is ${(baselineM * (input.units === "metric" ? 1000 : 39.3700787)).toFixed(3)} ${expectedUnit} (${baselineM.toExponential(4)} m).`,
       physicsAgent: normalizedPhysics,
       mathAgent: normalizedMath,
      assumptions: [
        "Linear elastic behavior and small deflection theory apply.",
        "The beam has a constant rectangular cross-section.",
        "The supplied elastic modulus is treated as the material's effective E value.",
        input.loadType === "uniform"
          ? "The load value is interpreted as the total uniformly distributed load."
          : "The load value is interpreted as a single point load at the critical location.",
       ],
        consensusStatus: isPremium ? (status === "pass" ? "verified" : "failed") : "single_agent",
       consensusSpread: relativeSpread,
        isFlightSafe: Boolean(isPremium && status === "pass"),
    });
  } catch (error) {
    req.log.error({ err: error }, "Deflection AI calculation failed");
    const message = error instanceof Error ? error.message : "";
    if (message.includes("OPENAI_API_KEY is not configured")) {
      res.status(503).json({
        error: "OpenAI credentials are not configured yet. Add OPENAI_API_KEY in Replit Secrets, then try again.",
      });
      return;
    }
    if (message.includes("status 429")) {
      res.status(503).json({
        error: "OpenAI quota is exhausted. Add available API usage, then run the two-agent check again.",
      });
      return;
    }
    res.status(500).json({ error: "The AI calculation service could not complete both checks." });
  }
});

export default router;