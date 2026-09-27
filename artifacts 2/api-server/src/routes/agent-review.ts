import { Router, type Request, type Response } from "express";

const router = Router();

type ReviewBody = {
  tier?: string;
  deflection?: number;
  mathDeflection?: number;
  variancePercent?: string;
  consensus?: boolean;
  physicsTrace?: string;
  mathTrace?: string;
  safetyLimit?: number;
  safetyPass?: boolean;
  material?: string;
  supportCondition?: string;
  loadPattern?: string;
  elasticModulus?: number;
  span?: number;
  width?: number;
  depth?: number;
  appliedLoad?: number;
  unitSystem?: string;
};

type RealismStatus = "plausible" | "review" | "high-concern";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

router.post("/agent-review", async (req: Request<unknown, unknown, ReviewBody>, res: Response) => {
  if (req.body.tier !== "premium") {
    res.status(403).json({ message: "Math AI Agent review is a Premium feature." });
    return;
  }

  const {
    deflection,
    mathDeflection,
    variancePercent,
    consensus,
    physicsTrace,
    mathTrace,
    safetyLimit,
    safetyPass,
    material,
    supportCondition,
    loadPattern,
    elasticModulus,
    span,
    width,
    depth,
    appliedLoad,
    unitSystem,
  } = req.body;
  if (
    !isFiniteNumber(deflection) ||
    !isFiniteNumber(mathDeflection) ||
    typeof variancePercent !== "string" ||
    typeof consensus !== "boolean" ||
    typeof physicsTrace !== "string" ||
    typeof mathTrace !== "string" ||
    !isFiniteNumber(safetyLimit) ||
    typeof safetyPass !== "boolean"
  ) {
    res.status(400).json({ message: "Both completed deterministic results and their traces are required." });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    req.log.error("OPENAI_API_KEY is not configured");
    res.status(503).json({ message: "Math AI Agent is not configured." });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        max_output_tokens: 160,
        input: [
          {
            role: "system",
            content:
              "You are the advisory explanation layer for a structural beam screening app. The Physics result and the independently computed numerical-audit result were both calculated in deterministic code before this request. The supplied traces show their methods. Never calculate, change, reconcile, average, or replace either result. Do not output any numerical deflection, variance, confidence score, or invented engineering value. Assess only whether the supplied results and context raise an obvious plausibility or serviceability concern. You cannot certify safety, predict failure with certainty, or replace a qualified structural engineer. Return ONLY valid JSON with this exact shape: {\"realismStatus\":\"plausible\"|\"review\"|\"high-concern\",\"realismSummary\":\"one or two readable sentences\"}. Use high-concern when the supplied deterministic response exceeds its screening limit or the inputs suggest an obvious red flag; use review when it passes but real-world context is missing; use plausible only when the provided results are internally consistent and below the screening limit. Always say that this is advisory and not a sign-off. Use only supplied values; never invent loads, forces, dimensions, or material properties.",
          },
          {
            role: "user",
            content: JSON.stringify({
              deflection: Number(deflection.toFixed(4)),
              mathDeflection: Number(mathDeflection.toFixed(4)),
              variancePercent,
              consensus,
              physicsTrace,
              mathTrace,
              safetyLimit: Number(safetyLimit.toFixed(4)),
              safetyPass,
              material,
              supportCondition,
              loadPattern,
              elasticModulus,
              span,
              width,
              depth,
              appliedLoad,
              unitSystem,
            }),
          },
        ],
      }),
    });

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      req.log.error({ status: response.status, message: payload.error?.message }, "OpenAI review failed");
      res.status(502).json({ message: "Math AI Agent could not review this result." });
      return;
    }

    const rawSummary =
      payload.output_text?.trim() ||
      payload.output
        ?.flatMap((item) => item.content ?? [])
        .filter((part) => part.type === "output_text" && typeof part.text === "string")
        .map((part) => part.text!.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
    if (!rawSummary) {
      res.status(502).json({ message: "Math AI Agent returned no review." });
      return;
    }

    let realismStatus: RealismStatus = safetyPass ? "review" : "high-concern";
    let realismSummary = rawSummary;
    try {
      const jsonStart = rawSummary.indexOf("{");
      const jsonEnd = rawSummary.lastIndexOf("}");
      const parsed = JSON.parse(rawSummary.slice(jsonStart, jsonEnd + 1)) as {
        realismStatus?: RealismStatus;
        realismSummary?: string;
      };
      if (parsed.realismStatus && ["plausible", "review", "high-concern"].includes(parsed.realismStatus)) {
        realismStatus = parsed.realismStatus;
      }
      if (parsed.realismSummary?.trim()) {
        realismSummary = parsed.realismSummary.trim();
      }
    } catch {
      // Preserve the successful model response as an advisory summary if it did not follow JSON exactly.
    }

    res.json({
      summary: realismSummary,
      realismStatus,
      realismSummary,
    });
  } catch (error) {
    req.log.error({ error }, "OpenAI review request failed");
    res.status(502).json({ message: "Math AI Agent could not review this result." });
  }
});

export default router;