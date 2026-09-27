export type SupportCondition = 'simply-supported' | 'cantilever' | 'fixed-fixed';
export type LoadPattern = 'point-center' | 'point-end' | 'udl';
export type PlanTier = 'freemium' | 'promium' | 'premium';

export type BeamInputs = {
  supportCondition: SupportCondition;
  loadPattern: LoadPattern;
  elasticModulus: number;
  span: number;
  width: number;
  depth: number;
  appliedLoad: number;
  unitSystem: 'metric' | 'imperial';
};

export type BeamResult = {
  deflectionM: number;
  deflectionDisplay: number;
  unitSystem: BeamInputs['unitSystem'];
  inertiaM4: number;
  loadN: number;
  modulusPa: number;
  spanM: number;
  safetyLimitDisplay: number;
  safetyPass: boolean;
  curve: number[];
  summary: string;
};

export type MathAgentResult = {
  deflectionM: number;
  deflectionDisplay: number;
  curve: number[];
  method: string;
  segments: number;
  coarseSegments: number;
  convergencePercent: number;
  trace: string;
};

export const MATERIALS = [
  { label: 'Structural Steel', metricE: 200, imperialE: 29000, tier: 'freemium' as PlanTier, domain: 'Civil' },
  { label: 'Basic Concrete', metricE: 30, imperialE: 4351, tier: 'freemium' as PlanTier, domain: 'Civil' },
  { label: 'Basic Aluminum', metricE: 69, imperialE: 10008, tier: 'freemium' as PlanTier, domain: 'General' },
  { label: 'Timber GL24', metricE: 11, imperialE: 1595, tier: 'freemium' as PlanTier, domain: 'General' },
  { label: 'Automotive 6061-T6', metricE: 68.9, imperialE: 9990, tier: 'promium' as PlanTier, domain: 'Automotive' },
  { label: 'High Strength Steel', metricE: 210, imperialE: 30458, tier: 'promium' as PlanTier, domain: 'Automotive' },
  { label: 'Architecture Reinforced Concrete', metricE: 34, imperialE: 4931, tier: 'promium' as PlanTier, domain: 'Architecture' },
  { label: 'Architecture Rebar Steel', metricE: 195, imperialE: 28279, tier: 'promium' as PlanTier, domain: 'Architecture' },
  { label: 'Aerospace Carbon Fiber', metricE: 135, imperialE: 19574, tier: 'premium' as PlanTier, domain: 'Aerospace' },
  { label: 'Aerospace Titanium', metricE: 116, imperialE: 16823, tier: 'premium' as PlanTier, domain: 'Aerospace' },
  { label: 'Inconel 718', metricE: 200, imperialE: 29008, tier: 'premium' as PlanTier, domain: 'Aerospace' },
] as const;

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return value;
}

function normalize(inputs: BeamInputs) {
  const spanM = inputs.unitSystem === 'metric'
    ? positive(inputs.span, 'Span')
    : positive(inputs.span, 'Span') * 0.3048;
  const widthM = inputs.unitSystem === 'metric'
    ? positive(inputs.width, 'Section width')
    : positive(inputs.width, 'Section width') * 0.0254;
  const depthM = inputs.unitSystem === 'metric'
    ? positive(inputs.depth, 'Section depth')
    : positive(inputs.depth, 'Section depth') * 0.0254;
  const modulusPa = inputs.unitSystem === 'metric'
    ? positive(inputs.elasticModulus, 'Elastic modulus') * 1_000_000_000
    : positive(inputs.elasticModulus, 'Elastic modulus') * 6_894_757.2932;

  if (inputs.unitSystem === 'metric') {
    return {
      spanM,
      widthM,
      depthM,
      loadN: positive(inputs.appliedLoad, 'Applied load') * 1000,
      loadNPerM: positive(inputs.appliedLoad, 'Applied load') * 1000,
      modulusPa,
    };
  }

  return {
    spanM,
    widthM,
    depthM,
    loadN: positive(inputs.appliedLoad, 'Applied load') * 4448.2216153,
    loadNPerM: (positive(inputs.appliedLoad, 'Applied load') * 4448.2216153) / 0.3048,
    modulusPa,
  };
}

type NormalizedBeam = ReturnType<typeof normalize>;

function deflectionAtPosition(
  inputs: BeamInputs,
  normalized: NormalizedBeam,
  positionM: number,
) {
  const { spanM, loadN, loadNPerM, modulusPa, widthM, depthM } = normalized;
  const inertiaM4 = (widthM * Math.pow(depthM, 3)) / 12;
  const rigidity = modulusPa * inertiaM4;
  const x = Math.min(Math.max(positionM, 0), spanM);
  const { supportCondition, loadPattern } = inputs;

  if (loadPattern === 'udl') {
    if (supportCondition === 'cantilever') {
      return (loadNPerM * x * x * (6 * spanM * spanM - 4 * spanM * x + x * x)) / (24 * rigidity);
    }
    if (supportCondition === 'fixed-fixed') {
      return (loadNPerM * x * x * Math.pow(spanM - x, 2)) / (24 * rigidity);
    }
    return (loadNPerM * x * (Math.pow(spanM, 3) - 2 * spanM * x * x + x * x * x)) / (24 * rigidity);
  }

  const loadPositionM = inputs.loadPattern === 'point-end' ? spanM : spanM / 2;

  if (supportCondition === 'cantilever') {
    if (x <= loadPositionM) {
      return (loadN * x * x * (3 * loadPositionM - x)) / (6 * rigidity);
    }
    return (loadN * loadPositionM * loadPositionM * (3 * x - loadPositionM)) / (6 * rigidity);
  }

  if (supportCondition === 'fixed-fixed') {
    if (loadPositionM === spanM) return 0;
    const halfSpan = spanM / 2;
    if (x <= halfSpan) {
      return (loadN * x * x * (3 * spanM - 4 * x)) / (48 * rigidity);
    }
    const distanceFromRight = spanM - x;
    return (loadN * distanceFromRight * distanceFromRight * (3 * spanM - 4 * distanceFromRight)) / (48 * rigidity);
  }

  if (loadPositionM === 0 || loadPositionM === spanM) return 0;
  const rightSegmentM = spanM - loadPositionM;
  if (x <= loadPositionM) {
    return (
      (loadN * rightSegmentM * x * (spanM * spanM - rightSegmentM * rightSegmentM - x * x)) /
      (6 * spanM * rigidity)
    );
  }
  const distanceFromRight = spanM - x;
  return (
    (loadN * loadPositionM * distanceFromRight * (spanM * spanM - loadPositionM * loadPositionM - distanceFromRight * distanceFromRight)) /
    (6 * spanM * rigidity)
  );
}

export function calculateBeam(inputs: BeamInputs): BeamResult {
  const normalized = normalize(inputs);
  const { spanM, widthM, depthM, loadN, modulusPa } = normalized;
  const inertiaM4 = (widthM * Math.pow(depthM, 3)) / 12;
  const displayMultiplier = inputs.unitSystem === 'metric' ? 1000 : 39.37007874;
  const safetyLimitDisplay = (spanM / 360) * displayMultiplier;
  const rigidity = modulusPa * inertiaM4;
  const coefficient = inputs.loadPattern === 'udl'
    ? inputs.supportCondition === 'cantilever'
      ? 1 / 8
      : inputs.supportCondition === 'fixed-fixed'
        ? 1 / 384
        : 5 / 384
    : inputs.supportCondition === 'cantilever'
      ? inputs.loadPattern === 'point-end' ? 1 / 3 : 5 / 48
      : inputs.loadPattern === 'point-center'
        ? inputs.supportCondition === 'fixed-fixed' ? 1 / 192 : 1 / 48
        : 0;
  const appliedLoad = inputs.loadPattern === 'udl' ? normalized.loadNPerM : loadN;
  const spanPower = inputs.loadPattern === 'udl' ? 4 : 3;
  const deflectionM = (coefficient * appliedLoad * Math.pow(spanM, spanPower)) / rigidity;
  const deflectionDisplay = deflectionM * displayMultiplier;
  if (!Number.isFinite(deflectionDisplay)) {
    throw new Error('These inputs produce a value outside the calculator’s numeric range.');
  }
  const curve = Array.from({ length: 201 }, (_, index) => {
    const x = index / 200;
    return deflectionAtPosition(inputs, normalized, x * spanM) * displayMultiplier;
  });

  return {
    deflectionM,
    deflectionDisplay,
    unitSystem: inputs.unitSystem,
    inertiaM4,
    loadN,
    modulusPa,
    spanM,
    safetyLimitDisplay,
    safetyPass: deflectionDisplay <= safetyLimitDisplay,
    curve,
    summary:
      inputs.supportCondition === 'cantilever'
        ? 'Physics AI Agent evaluated the cantilever response and peak movement.'
        : 'Physics AI Agent evaluated the supported-beam response and peak movement.',
  };
}

/**
 * Independent numerical audit. It integrates curvature (M / EI) twice over a
 * uniform mesh and enforces each support's boundary conditions. It deliberately
 * does not call the closed-form Physics solver or its response-curve function.
 */
export function calculateMathAgentDeflection(inputs: BeamInputs, segments = 200): MathAgentResult {
  if (!Number.isInteger(segments) || segments < 20) {
    throw new Error('The numerical audit requires at least 20 mesh segments.');
  }

  const normalized = normalize(inputs);
  const inertiaM4 = (normalized.widthM * Math.pow(normalized.depthM, 3)) / 12;
  const rigidity = normalized.modulusPa * inertiaM4;
  const fine = integrateCurvatureMesh(inputs, normalized, rigidity, segments);
  const coarseSegments = Math.max(20, Math.floor(segments / 2));
  const coarse = integrateCurvatureMesh(inputs, normalized, rigidity, coarseSegments);
  const displayMultiplier = inputs.unitSystem === 'metric' ? 1000 : 39.37007874;
  const fineM = fine.peakDeflectionM;
  const coarseM = coarse.peakDeflectionM;
  const convergencePercent = fineM === 0
    ? coarseM === 0 ? 0 : Infinity
    : Math.abs(fineM - coarseM) / Math.abs(fineM) * 100;
  const deflectionDisplay = fineM * displayMultiplier;
  const trace = [
    'Method: composite-trapezoid integration of M(x)/EI twice',
    `Mesh: ${segments} uniform segments (${segments + 1} nodes)`,
    `Coarse comparison: ${coarseSegments} segments`,
    `Coarse peak: ${(coarseM * displayMultiplier).toPrecision(7)} ${inputs.unitSystem === 'metric' ? 'mm' : 'in'}`,
    `Fine peak: ${deflectionDisplay.toPrecision(7)} ${inputs.unitSystem === 'metric' ? 'mm' : 'in'}`,
    `Mesh convergence: ${Number.isFinite(convergencePercent) ? `${convergencePercent.toFixed(4)}%` : 'not finite'}`,
  ].join(' · ');

  if (!Number.isFinite(deflectionDisplay) || !Number.isFinite(convergencePercent)) {
    if (deflectionDisplay !== 0 || convergencePercent !== Infinity) {
      throw new Error('The numerical audit could not resolve these inputs.');
    }
  }

  return {
    deflectionM: fineM,
    deflectionDisplay,
    curve: fine.deflectionCurveM.map((deflectionM) => deflectionM * displayMultiplier),
    method: 'Numerical curvature integration',
    segments,
    coarseSegments,
    convergencePercent,
    trace,
  };
}

type CurvatureIntegration = {
  slopeAtEnd: number;
  deflectionAtEnd: number;
  deflections: number[];
};

function integrateCurvatureMesh(
  inputs: BeamInputs,
  normalized: NormalizedBeam,
  rigidity: number,
  segments: number,
): { peakDeflectionM: number; deflectionCurveM: number[] } {
  const { spanM, loadN, loadNPerM } = normalized;
  const step = spanM / segments;
  const pointPosition = inputs.loadPattern === 'point-end' ? spanM : spanM / 2;

  const integrate = (leftMoment: number, shear: number, includeAppliedLoad: boolean): CurvatureIntegration => {
    const slopes = new Array<number>(segments + 1).fill(0);
    const deflections = new Array<number>(segments + 1).fill(0);
    let previousCurvature = leftMoment / rigidity;

    for (let index = 1; index <= segments; index += 1) {
      const x = index * step;
      let moment = leftMoment + shear * x;
      if (includeAppliedLoad && inputs.loadPattern === 'udl') {
        moment -= loadNPerM * x * x / 2;
      } else if (includeAppliedLoad && x > pointPosition) {
        moment -= loadN * (x - pointPosition);
      }
      const curvature = moment / rigidity;
      slopes[index] = slopes[index - 1] + (previousCurvature + curvature) * step / 2;
      deflections[index] = deflections[index - 1] + (slopes[index - 1] + slopes[index]) * step / 2;
      previousCurvature = curvature;
    }

    return {
      slopeAtEnd: slopes[segments],
      deflectionAtEnd: deflections[segments],
      deflections,
    };
  };

  let leftMoment = 0;
  let shear = 0;
  let initialSlope = 0;

  if (inputs.supportCondition === 'simply-supported') {
    shear = inputs.loadPattern === 'udl'
      ? loadNPerM * spanM / 2
      : loadN * (spanM - pointPosition) / spanM;
  } else if (inputs.supportCondition === 'cantilever') {
    shear = inputs.loadPattern === 'udl' ? loadNPerM * spanM : loadN;
    leftMoment =
      (inputs.loadPattern === 'udl' ? loadNPerM * spanM * spanM / 2 : 0) +
      (inputs.loadPattern === 'udl' ? 0 : loadN * (spanM - pointPosition)) -
      shear * spanM;
  } else {
    const base = integrate(0, 0, true);
    const momentMode = integrate(1, 0, false);
    const shearMode = integrate(0, 1, false);
    const a = momentMode.slopeAtEnd;
    const b = shearMode.slopeAtEnd;
    const c = momentMode.deflectionAtEnd;
    const d = shearMode.deflectionAtEnd;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || determinant === 0) {
      throw new Error('The fixed-support numerical audit could not solve its boundary conditions.');
    }
    leftMoment = (-base.slopeAtEnd * d + b * base.deflectionAtEnd) / determinant;
    shear = (-a * base.deflectionAtEnd + base.slopeAtEnd * c) / determinant;
  }

  const integrated = integrate(leftMoment, shear, true);
  if (inputs.supportCondition === 'simply-supported') {
    initialSlope = -integrated.deflectionAtEnd / spanM;
  }
  const deflectionCurveM = integrated.deflections.map((deflection, index) =>
    Math.abs(deflection + initialSlope * index * step),
  );
  const peakDeflectionM = Math.max(...deflectionCurveM);
  return { peakDeflectionM, deflectionCurveM };
}
