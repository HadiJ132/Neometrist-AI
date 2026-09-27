import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { reviewBeamWithMathAgent } from '@workspace/api-client-react';
import colors from '@/constants/colors';
import {
  BeamInputs,
  BeamResult,
  calculateBeam,
  calculateMathAgentDeflection,
  LoadPattern,
  MATERIALS,
  PlanTier,
  SupportCondition,
} from '@/lib/physicsEngine';
import { useSubscription } from '@/lib/revenuecat';
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

type HistoryItem = {
  id: string;
  createdAt: string;
  material: string;
  result: BeamResult;
  inputs: BeamInputs;
};

type MathReview = {
  summary: string;
  deflection?: number;
  deflectionM?: number;
  curve?: number[];
  variancePercent?: number;
  consensus: boolean;
  available: boolean;
  method?: string;
  segments?: number;
  coarseSegments?: number;
  convergencePercent?: number;
  trace?: string;
  realismStatus?: 'plausible' | 'review' | 'high-concern';
  realismSummary?: string;
};

type Material = (typeof MATERIALS)[number];
type Selector = 'support' | 'load' | 'material' | null;
type ConsensusState = 'pending' | 'verified' | 'failed';
const DRAWER_WIDTH = Math.min(326, Dimensions.get('window').width * 0.86);
type AgentWorkingPanelProps = {
  result: BeamResult;
  inputs: BeamInputs;
  tier: PlanTier;
  mathReview?: MathReview;
  mathReviewLoading: boolean;
};

type BeamDerivation = {
  normalizedInputs: string;
  sectionProperties: string;
  physicsEquation: string;
  screeningEquation: string;
  mathEquation: string;
};

const initialInputs: BeamInputs = {
  supportCondition: 'simply-supported',
  loadPattern: 'point-center',
  elasticModulus: 200,
  span: 4.8,
  width: 0.12,
  depth: 0.24,
  appliedLoad: 8.5,
  unitSystem: 'metric',
};

type NumericInputKey = 'elasticModulus' | 'span' | 'width' | 'depth' | 'appliedLoad';
type InputDrafts = Record<NumericInputKey, string>;

function draftsFor(inputs: BeamInputs): InputDrafts {
  return {
    elasticModulus: String(inputs.elasticModulus),
    span: String(inputs.span),
    width: String(inputs.width),
    depth: String(inputs.depth),
    appliedLoad: String(inputs.appliedLoad),
  };
}

function formatScientific(value: number, digits = 3) {
  return value.toExponential(digits).replace('e+', 'e');
}

function formatCalculationValue(value: number) {
  if (value === 0) return '0.000000';
  return Number.isFinite(value) ? value.toPrecision(7) : 'not finite';
}

function formatHeadlineDeflectionMm(valueMm: number) {
  return parseFloat(valueMm.toPrecision(4)).toString();
}

function formatNanometers(valueNm: number) {
  return Number.isFinite(valueNm) ? parseFloat(valueNm.toPrecision(4)).toString() : 'not finite';
}

function formatVariancePercent(value: number) {
  if (Number.isNaN(value)) return 'invalid';
  if (!Number.isFinite(value)) return '∞';
  return value === 0 ? '0' : parseFloat(value.toPrecision(4)).toString();
}

function buildBeamDerivation(result: BeamResult, inputs: BeamInputs): BeamDerivation {
  const outputUnit = inputs.unitSystem === 'metric' ? 'mm' : 'in';
  const widthM = inputs.unitSystem === 'metric' ? inputs.width : inputs.width * 0.0254;
  const depthM = inputs.unitSystem === 'metric' ? inputs.depth : inputs.depth * 0.0254;
  const modulusGPa = inputs.unitSystem === 'metric' ? inputs.elasticModulus : inputs.elasticModulus * 0.0068947572932;
  const pointLoadN = result.loadN;
  const distributedLoadNPerM = inputs.unitSystem === 'metric'
    ? inputs.appliedLoad * 1000
    : (inputs.appliedLoad * 4448.2216153) / 0.3048;
  const inertia = result.inertiaM4;
  const rigidity = result.modulusPa * inertia;
  const loadValue = inputs.loadPattern === 'udl' ? distributedLoadNPerM : pointLoadN;
  const loadLabel = inputs.loadPattern === 'udl' ? 'w' : 'P';
  const loadDisplay = inputs.loadPattern === 'udl'
    ? `${(distributedLoadNPerM / 1000).toFixed(3)} kN/m`
    : `${(pointLoadN / 1000).toFixed(3)} kN`;
  const normalizedInputs = `L = ${result.spanM.toFixed(3)} m · b = ${widthM.toFixed(3)} m · h = ${depthM.toFixed(3)} m · E = ${modulusGPa.toFixed(3)} GPa · ${loadLabel} = ${loadDisplay}`;
  const sectionProperties = `I = b h³ / 12 = ${formatScientific(inertia)} m⁴ · EI = E I = ${formatScientific(rigidity)} N·m²`;

  let coefficientText: string;
  let equationText: string;
  if (inputs.loadPattern === 'udl') {
    const coefficient = inputs.supportCondition === 'cantilever' ? '1/8' : inputs.supportCondition === 'fixed-fixed' ? '1/384' : '5/384';
    coefficientText = inputs.supportCondition === 'cantilever'
      ? 'δmax = wL⁴ / (8EI)'
      : inputs.supportCondition === 'fixed-fixed'
        ? 'δmax = wL⁴ / (384EI)'
        : 'δmax = 5wL⁴ / (384EI)';
    equationText = `${coefficientText} = ${coefficient} × ${loadValue.toFixed(1)} × ${result.spanM.toFixed(3)}⁴ / ${rigidity.toFixed(1)} = ${formatCalculationValue(result.deflectionDisplay)} ${outputUnit}`;
  } else if (inputs.supportCondition === 'cantilever') {
    coefficientText = inputs.loadPattern === 'point-end' ? 'δmax = PL³ / (3EI)' : 'δmax = 5PL³ / (48EI)';
    equationText = inputs.loadPattern === 'point-end'
      ? `${coefficientText} = ${loadValue.toFixed(1)} × ${result.spanM.toFixed(3)}³ / (3 × ${rigidity.toFixed(1)}) = ${formatCalculationValue(result.deflectionDisplay)} ${outputUnit}`
      : `${coefficientText} = 5 × ${loadValue.toFixed(1)} × ${result.spanM.toFixed(3)}³ / (48 × ${rigidity.toFixed(1)}) = ${formatCalculationValue(result.deflectionDisplay)} ${outputUnit}`;
  } else if (inputs.loadPattern === 'point-center') {
    coefficientText = inputs.supportCondition === 'fixed-fixed' ? 'δmax = PL³ / (192EI)' : 'δmax = PL³ / (48EI)';
    equationText = `${coefficientText} = ${loadValue.toFixed(1)} × ${result.spanM.toFixed(3)}³ / (${inputs.supportCondition === 'fixed-fixed' ? '192' : '48'} × ${rigidity.toFixed(1)}) = ${formatCalculationValue(result.deflectionDisplay)} ${outputUnit}`;
  } else {
    coefficientText = 'δmax = 0 for a point load applied directly at the supported end';
    equationText = `${coefficientText} = ${formatCalculationValue(result.deflectionDisplay)} ${outputUnit}`;
  }

  const mathEquation = 'Independent numerical method: integrate curvature M(x)/EI twice; no Physics-lane formula is reused.';
  const screeningEquation = `Screening: δmax ${result.safetyPass ? '≤' : '>'} L/360 = ${result.safetyLimitDisplay.toFixed(2)} ${outputUnit} → ${result.safetyPass ? 'WITHIN LIMIT' : 'REVIEW LOAD'}`;

  return {
    normalizedInputs,
    sectionProperties,
    physicsEquation: `Physics Agent: ${equationText}`,
    screeningEquation,
    mathEquation,
  };
}

const TIER_CONFIG: Record<
  PlanTier,
  { name: string; short: string; limit: number; feature: string; detail: string; color: string }
> = {
  freemium: {
    name: 'FREEMIUM',
    short: 'STARTER',
    limit: 10,
    feature: 'Physics lane active · Math lane locked',
    detail: 'Core materials + visual guide · 10 calculations / month',
    color: colors.dark.mutedForeground,
  },
  promium: {
    name: 'PROMIUM',
    short: 'BUILDER',
    limit: 30,
    feature: 'Physics lane active · Math lane locked',
    detail: 'Automotive + architecture materials · 30 calculations / month',
    color: colors.dark.accent,
  },
  premium: {
    name: 'PREMIUM',
    short: 'CONSENSUS',
    limit: Infinity,
    feature: 'Dual-lane intelligence + consensus',
    detail: 'Aerospace + advanced materials · full history · unlimited calculations',
    color: colors.dark.primary,
  },
};

const tierRank: Record<PlanTier, number> = { freemium: 0, promium: 1, premium: 2 };

const supportOptions: Array<{ key: SupportCondition; label: string }> = [
  { key: 'simply-supported', label: 'Simply supported' },
  { key: 'cantilever', label: 'Cantilever' },
  { key: 'fixed-fixed', label: 'Fixed–fixed' },
];

const loadOptions: Array<{ key: LoadPattern; label: string }> = [
  { key: 'point-center', label: 'Point at center' },
  { key: 'point-end', label: 'Point at end' },
  { key: 'udl', label: 'Distributed load' },
];

const presets: Array<{
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tier: PlanTier;
  material: string;
  values: Partial<BeamInputs>;
}> = [
  {
    key: 'civil',
    label: 'Civil beam',
    icon: 'triangle',
    tier: 'freemium',
    material: 'Structural Steel',
    values: { supportCondition: 'simply-supported', loadPattern: 'point-center', span: 4.8, width: 0.12, depth: 0.24, appliedLoad: 8.5, elasticModulus: 200 },
  },
  {
    key: 'floor',
    label: 'Floor beam',
    icon: 'grid',
    tier: 'freemium',
    material: 'Basic Concrete',
    values: { supportCondition: 'simply-supported', loadPattern: 'udl', span: 5.2, width: 0.16, depth: 0.28, appliedLoad: 6.8, elasticModulus: 30 },
  },
  {
    key: 'roof',
    label: 'Roof beam',
    icon: 'home',
    tier: 'promium',
    material: 'Architecture Reinforced Concrete',
    values: { supportCondition: 'fixed-fixed', loadPattern: 'udl', span: 4.1, width: 0.12, depth: 0.2, appliedLoad: 4.7, elasticModulus: 34 },
  },
  {
    key: 'automotive',
    label: 'Automotive chassis',
    icon: 'truck',
    tier: 'promium',
    material: 'Automotive 6061-T6',
    values: { supportCondition: 'simply-supported', loadPattern: 'point-center', span: 1.8, width: 0.06, depth: 0.1, appliedLoad: 4.4, elasticModulus: 68.9 },
  },
  {
    key: 'aerospace',
    label: 'Aerospace wing',
    icon: 'wind',
    tier: 'premium',
    material: 'Aerospace Carbon Fiber',
    values: { supportCondition: 'cantilever', loadPattern: 'point-end', span: 2.4, width: 0.08, depth: 0.16, appliedLoad: 3.2, elasticModulus: 135 },
  },
];

function formatLimit(limit: number) {
  return limit === Infinity ? '∞' : String(limit);
}

function tierIsAvailable(materialTier: PlanTier, currentTier: PlanTier) {
  return tierRank[currentTier] >= tierRank[materialTier];
}

function Header({ onMenu }: { onMenu: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable testID="menu-button" onPress={onMenu} style={styles.iconButton}>
        <Feather name="menu" size={20} color={colors.dark.text} />
      </Pressable>
      <View style={styles.brand}>
        <Text style={styles.brandName}>NEOMETRIST AI</Text>
        <Text style={styles.brandSubline}>DUAL STRUCTURAL INTELLIGENCE</Text>
      </View>
      <View style={styles.liveMark}>
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>LIVE</Text>
      </View>
    </View>
  );
}

function TierBadge({ tier, compact = false }: { tier: PlanTier; compact?: boolean }) {
  const config = TIER_CONFIG[tier];
  return (
    <View style={[styles.tierBadge, { borderColor: config.color }]}>
      <View style={[styles.tierBadgeDot, { backgroundColor: config.color }]} />
      <Text style={[styles.tierBadgeText, { color: config.color }]}>{compact ? config.short : config.name}</Text>
    </View>
  );
}

function BeamVisualizer({ result, inputs }: { result?: BeamResult; inputs: BeamInputs }) {
  const width = 360;
  const height = 230;
  const beamY = result ? 116 : 108;
  const curve = result?.curve ?? Array.from({ length: 41 }, () => 0);
  const curveScale = Math.max(result?.deflectionDisplay ?? 1, result?.safetyLimitDisplay ?? 1, 0.1);
  const curveStartX = inputs.supportCondition === 'cantilever' ? 46 : 70;
  const curveEndX = 290;
  const path = curve
    .map((point, index) => {
      const x = curveStartX + ((curveEndX - curveStartX) * index) / Math.max(curve.length - 1, 1);
      const y = beamY + (point / curveScale) * 62;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  const pointLoadX = inputs.loadPattern === 'point-end' ? 290 : 180;

  return (
    <View style={styles.visualCard}>
      <View style={styles.visualHeader}>
        <View style={styles.visualHeaderCopy}>
          <Text style={styles.sectionKicker}>01 / LIVE MODEL</Text>
          <Text style={styles.visualTitle}>BEAM BENDING MAP</Text>
          <Text style={styles.visualCaption}>{result ? 'Physics AI Agent · refined response curve' : 'Set a scenario to solve the curve'}</Text>
        </View>
        <View style={styles.solvePill}>
          <View style={[styles.solveDot, result && styles.solveDotActive]} />
          <Text style={styles.solvePillText}>{result ? 'SOLVED' : 'READY'}</Text>
        </View>
      </View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Rect x="0" y="0" width={width} height={height} fill={colors.dark.background} />
        {Array.from({ length: 9 }, (_, index) => (
          <Line key={`v-${index}`} x1={index * 45} y1="0" x2={index * 45} y2={height} stroke={colors.dark.grid} strokeWidth="1" />
        ))}
        {Array.from({ length: 6 }, (_, index) => (
          <Line key={`h-${index}`} x1="0" y1={index * 43} x2={width} y2={index * 43} stroke={colors.dark.grid} strokeWidth="1" />
        ))}
        {inputs.supportCondition === 'simply-supported' ? (
          <>
            <Polygon points="48,166 72,116 96,166" fill={colors.dark.blue} />
            <Polygon points="258,166 282,116 306,166" fill={colors.dark.blue} />
            <Circle cx="274" cy="174" r="5" fill={colors.dark.accent} />
            <Circle cx="290" cy="174" r="5" fill={colors.dark.accent} />
            <Line x1="44" y1="170" x2="100" y2="170" stroke={colors.dark.borderStrong} strokeWidth="2" />
            <Line x1="254" y1="181" x2="310" y2="181" stroke={colors.dark.borderStrong} strokeWidth="2" />
            {Array.from({ length: 5 }, (_, index) => (
              <Line key={`left-hatch-${index}`} x1={49 + index * 10} y1="170" x2={43 + index * 10} y2="177" stroke={colors.dark.mutedForeground} strokeWidth="1" />
            ))}
          </>
        ) : inputs.supportCondition === 'fixed-fixed' ? (
          <>
            <Rect x="46" y="82" width="18" height="96" fill={colors.dark.blue} />
            <Rect x="296" y="82" width="18" height="96" fill={colors.dark.blue} />
            {Array.from({ length: 6 }, (_, index) => (
              <React.Fragment key={`fixed-hatch-${index}`}>
                <Line x1="43" y1={88 + index * 15} x2="67" y2={78 + index * 15} stroke={colors.dark.accent} strokeWidth="1" />
                <Line x1="293" y1={88 + index * 15} x2="317" y2={78 + index * 15} stroke={colors.dark.accent} strokeWidth="1" />
              </React.Fragment>
            ))}
          </>
        ) : (
          <>
            <Rect x="28" y="66" width="18" height="112" fill={colors.dark.blue} opacity={0.9} />
            {Array.from({ length: 6 }, (_, index) => (
              <Line key={`wall-${index}`} x1="25" y1={74 + index * 17} x2="49" y2={65 + index * 17} stroke={colors.dark.accent} strokeWidth="1" />
            ))}
          </>
        )}
        {result && <Line x1="40" y1={beamY} x2="320" y2={beamY} stroke={colors.dark.mutedForeground} strokeWidth="1" strokeDasharray="4 6" opacity={0.5} />}
        <Line x1={inputs.supportCondition === 'cantilever' ? 46 : 70} y1={beamY} x2="290" y2={beamY} stroke={colors.dark.accent} strokeWidth="8" strokeLinecap="round" opacity={result ? 0.22 : 1} />
        {inputs.loadPattern === 'udl' ? (
          Array.from({ length: 7 }, (_, index) => {
            const x = 86 + index * 31;
            return (
              <React.Fragment key={`udl-${index}`}>
                <Line x1={x} y1="43" x2={x} y2={beamY - 19} stroke={colors.dark.primary} strokeWidth="1.5" opacity={0.82} />
                <Polygon points={`${x - 4},${beamY - 24} ${x + 4},${beamY - 24} ${x},${beamY - 16}`} fill={colors.dark.primary} />
              </React.Fragment>
            );
          })
        ) : null}
        {result && <Path d={path} fill="none" stroke={colors.dark.primary} strokeWidth="14" strokeLinecap="round" opacity={0.18} />}
        {result && <Path d={path} fill="none" stroke={colors.dark.primary} strokeWidth="5" strokeLinecap="round" />}
        {inputs.loadPattern !== 'udl' ? (
          <>
            <Line x1={pointLoadX} y1="38" x2={pointLoadX} y2={beamY - 20} stroke={colors.dark.primary} strokeWidth="3" />
            <Polygon points={`${pointLoadX - 8},${beamY - 25} ${pointLoadX + 8},${beamY - 25} ${pointLoadX},${beamY - 15}`} fill={colors.dark.primary} />
            <SvgText x={Math.max(8, pointLoadX - 34)} y="27" fill={colors.dark.primary} fontSize="9" fontWeight="bold">APPLIED LOAD</SvgText>
          </>
        ) : (
          <SvgText x="134" y="27" fill={colors.dark.primary} fontSize="9" fontWeight="bold">DISTRIBUTED LOAD</SvgText>
        )}
        {result && <Circle cx={inputs.supportCondition === 'cantilever' ? 290 : 180} cy={beamY + (Math.max(...curve) / curveScale) * 62} r="5" fill={colors.dark.primary} />}
      </Svg>
      <View style={styles.visualFooter}>
        <Text style={styles.monoLabel}>{inputs.supportCondition === 'cantilever' ? 'FIXED ROOT' : 'SUPPORT LINE'}</Text>
        <Text style={styles.monoLabel}>{inputs.loadPattern === 'udl' ? 'UDL / DISTRIBUTED' : 'P / POINT LOAD'}</Text>
      </View>
    </View>
  );
}

function DeflectionGraph({
  result,
  mathReview,
  tier,
}: {
  result: BeamResult;
  mathReview?: MathReview;
  tier: PlanTier;
}) {
  const [zoomToPeak, setZoomToPeak] = useState(false);
  const width = 360;
  const height = 232;
  const left = 42;
  const top = 24;
  const chartWidth = 292;
  const chartHeight = 154;
  const numericalCurve = mathReview?.curve;
  const hasNumericalCurve = Boolean(numericalCurve?.length);
  const consensusFailed = Boolean(
    tier === 'premium' &&
    mathReview?.available &&
    mathReview.variancePercent !== undefined &&
    mathReview.variancePercent > 1,
  );
  useEffect(() => {
    setZoomToPeak(false);
  }, [result]);
  useEffect(() => {
    if (consensusFailed) setZoomToPeak(true);
  }, [consensusFailed]);

  const scaleMax = Math.max(result.deflectionDisplay, result.safetyLimitDisplay, 0.1);
  const peakValue = Math.max(result.deflectionDisplay, mathReview?.deflection ?? 0, 1e-9);
  const lanePeakDifference = Math.abs((mathReview?.deflection ?? result.deflectionDisplay) - result.deflectionDisplay);
  const zoomRange = Math.max(peakValue / 200, lanePeakDifference * 2.4);
  const peakZoomFactor = peakValue / zoomRange;
  const yMin = zoomToPeak ? peakValue - zoomRange / 2 : 0;
  const yRange = zoomToPeak ? zoomRange : scaleMax;
  const makePath = (curve: number[]) =>
    curve
      .map((point, index) => {
        const x = left + (chartWidth * index) / Math.max(curve.length - 1, 1);
        const y = top + ((point - yMin) / yRange) * chartHeight;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  const physicsPath = makePath(result.curve);
  const numericalPath = numericalCurve ? makePath(numericalCurve) : undefined;
  const limitY = top + ((result.safetyLimitDisplay - yMin) / yRange) * chartHeight;

  return (
    <View style={[styles.graphCard, consensusFailed && styles.graphCardDisagreement]}>
      <View style={styles.graphHeader}>
        <View style={styles.resultHeaderCopy}>
          <Text style={styles.sectionKicker}>03 / RESPONSE PROFILE</Text>
          <Text style={styles.graphTitle}>DEFLECTION CURVE</Text>
        </View>
        {hasNumericalCurve ? (
          <Pressable
            testID="zoom-to-peak-toggle"
            accessibilityRole="button"
            accessibilityState={{ selected: zoomToPeak }}
            onPress={() => setZoomToPeak((current) => !current)}
            style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]}
          >
            <Feather name={zoomToPeak ? 'minimize-2' : 'maximize-2'} size={13} color={colors.dark.accent} />
            <Text style={styles.zoomButtonText}>{zoomToPeak ? 'FULL SPAN' : 'ZOOM TO PEAK'}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.graphLegendRows}>
        <View style={styles.graphLegendItem}>
          <View style={[styles.legendLine, { backgroundColor: colors.dark.primary }]} />
          <Text style={styles.legendText}>Closed form (exact)</Text>
        </View>
        {numericalCurve ? (
          <View style={styles.graphLegendItem}>
            <View style={[styles.legendLine, styles.legendNumericalLine, { backgroundColor: colors.dark.accent }]} />
            <Text style={styles.legendText}>Numerical integration ({numericalCurve.length} nodes)</Text>
          </View>
        ) : null}
      </View>
      {zoomToPeak ? <Text style={styles.graphZoomHint}>Peak-centered detail · {peakZoomFactor.toPrecision(3)}× at peak scale</Text> : null}
      {consensusFailed ? <Text style={styles.graphDisagreementHint}>CONSENSUS FAILED · BOTH CALCULATION LANES SHOWN</Text> : null}
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Rect x="0" y="0" width={width} height={height} fill={consensusFailed ? colors.dark.failSurface : colors.dark.input} />
        {Array.from({ length: 5 }, (_, index) => {
          const y = top + (chartHeight * index) / 4;
          return <Line key={`gy-${index}`} x1={left} y1={y} x2={left + chartWidth} y2={y} stroke={colors.dark.grid} strokeWidth="1" />;
        })}
        {Array.from({ length: 7 }, (_, index) => {
          const x = left + (chartWidth * index) / 6;
          return <Line key={`gx-${index}`} x1={x} y1={top} x2={x} y2={top + chartHeight} stroke={colors.dark.grid} strokeWidth="1" />;
        })}
        <Line x1={left} y1={top} x2={left} y2={top + chartHeight} stroke={colors.dark.mutedForeground} strokeWidth="1" />
        <Line x1={left} y1={top} x2={left + chartWidth} y2={top} stroke={colors.dark.mutedForeground} strokeWidth="1" />
        {!zoomToPeak ? <Line x1={left} y1={limitY} x2={left + chartWidth} y2={limitY} stroke={colors.dark.success} strokeWidth="2" strokeDasharray="5 5" /> : null}
        <Path d={physicsPath} fill="none" stroke={colors.dark.primary} strokeWidth="3" strokeLinecap="round" />
        {numericalPath ? <Path d={numericalPath} fill="none" stroke={colors.dark.accent} strokeWidth="2" strokeLinecap="round" /> : null}
        <SvgText x="10" y={top + 4} fill={colors.dark.mutedForeground} fontSize="9">{zoomToPeak ? 'PEAK' : 'MAX'}</SvgText>
        {!zoomToPeak ? <SvgText x="8" y={limitY + 4} fill={colors.dark.success} fontSize="8">L/360</SvgText> : null}
        <SvgText x={left - 2} y={top + chartHeight + 19} fill={colors.dark.mutedForeground} fontSize="9">0</SvgText>
        <SvgText x={left + chartWidth - 10} y={top + chartHeight + 19} fill={colors.dark.mutedForeground} fontSize="9">L</SvgText>
        <SvgText x={left + chartWidth - 72} y={top + chartHeight + 36} fill={colors.dark.mutedForeground} fontSize="9">SPAN POSITION</SvgText>
      </Svg>
      <View style={styles.graphMetrics}>
        <View>
          <Text style={styles.metricLabel}>PEAK RESPONSE</Text>
          <Text style={styles.graphMetricValue}>{formatCalculationValue(result.deflectionDisplay)} {result.unitSystem === 'metric' ? 'mm' : 'in'}</Text>
        </View>
        <View>
          <Text style={styles.metricLabel}>SCREENING LIMIT</Text>
          <Text style={[styles.graphMetricValue, { color: colors.dark.success }]}>{result.safetyLimitDisplay.toFixed(2)} {result.unitSystem === 'metric' ? 'mm' : 'in'}</Text>
        </View>
      </View>
    </View>
  );
}

function Field({
  label,
  unit,
  value,
  onChangeText,
  testID,
}: {
  label: string;
  unit?: string;
  value: string;
  onChangeText: (value: string) => void;
  testID: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {unit ? <Text style={styles.fieldUnit}>{unit}</Text> : null}
      </View>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholderTextColor={colors.dark.mutedForeground}
        style={styles.input}
      />
    </View>
  );
}

function SelectField({ label, value, onPress, locked = false }: { label: string; value: string; onPress: () => void; locked?: boolean }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.selectInput, pressed && styles.pressed]}>
        <Text style={styles.selectText}>{value}</Text>
        <Feather name={locked ? 'lock' : 'chevron-down'} size={17} color={locked ? colors.dark.primary : colors.dark.mutedForeground} />
      </Pressable>
    </View>
  );
}

function AgentCard({
  icon,
  title,
  status,
  code,
  locked = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  status: string;
  code: string;
  locked?: boolean;
}) {
  return (
    <View style={[styles.agentCard, locked ? styles.agentCardLocked : styles.agentCardActive]}>
      <View style={styles.agentCardTopline}>
        <View style={[styles.agentCardIcon, locked && styles.agentCardIconLocked]}>
          <Feather name={locked ? 'lock' : icon} size={15} color={locked ? colors.dark.mutedForeground : colors.dark.primary} />
        </View>
        <Text style={styles.agentCardCode}>{code}</Text>
      </View>
      <Text style={[styles.agentCardTitle, locked && styles.agentCardTitleLocked]}>{title}</Text>
      <Text style={styles.agentCardStatus}>{status}</Text>
      <View style={[styles.agentCardState, locked ? styles.agentStateLocked : styles.agentStateActive]}>
        <View style={[styles.agentStateDot, locked && styles.agentStateDotLocked]} />
        <Text style={[styles.agentStateText, locked && styles.agentStateTextLocked]}>{locked ? 'LOCKED' : 'ACTIVE'}</Text>
      </View>
    </View>
  );
}

function AgentAccessPanel({
  tier,
  mathReview,
  mathReviewLoading = false,
}: {
  tier: PlanTier;
  mathReview?: MathReview;
  mathReviewLoading?: boolean;
}) {
  const mathReady = Boolean(mathReview?.available && typeof mathReview.deflection === 'number');
  return (
    <View style={styles.agentCards}>
      <AgentCard icon="cpu" code="01" title="PHYSICS AI AGENT" status="Deterministic structural assessment" />
      <AgentCard
        icon="bar-chart-2"
        code="02"
        title="MATH AI AGENT"
        status={
          tier === 'premium'
            ? mathReviewLoading
              ? 'Independent verification in progress'
              : mathReady
                ? 'Independent verification complete'
                : 'Premium verification ready'
            : 'Premium access required for independent verification'
        }
        locked={tier !== 'premium'}
      />
    </View>
  );
}

function RealismReviewCard({ mathReview, loading }: { mathReview?: MathReview; loading: boolean }) {
  if (!loading && !mathReview?.realismStatus) return null;
  const status = mathReview?.realismStatus;
  const statusLabel = status === 'plausible' ? 'PLAUSIBLE' : status === 'high-concern' ? 'HIGH CONCERN' : 'REVIEW ADVISED';
  const statusStyle = status === 'plausible' ? styles.realismPlausible : status === 'high-concern' ? styles.realismConcern : styles.realismReview;
  return (
    <View style={[styles.realismCard, statusStyle]}>
      <View style={styles.realismHeader}>
        <View style={styles.realismIcon}><Feather name={status === 'high-concern' ? 'alert-triangle' : 'shield'} size={16} color={status === 'plausible' ? colors.dark.success : colors.dark.primary} /></View>
        <View style={styles.realismHeaderCopy}>
          <Text style={styles.realismLabel}>OPENAI PLAUSIBILITY CHECK</Text>
          <Text style={styles.realismTitle}>{loading ? 'REVIEW IN PROGRESS' : statusLabel}</Text>
        </View>
      </View>
      <Text style={styles.realismBody}>
        {loading
          ? 'OpenAI is checking whether the completed response has an obvious realism or hold-up concern.'
          : mathReview?.realismSummary}
      </Text>
      <Text style={styles.realismFootnote}>ADVISORY ONLY · NOT A STRUCTURAL SIGN-OFF OR FAILURE PREDICTION</Text>
    </View>
  );
}

function AgentWorkingPanel({ result, inputs, tier, mathReview, mathReviewLoading }: AgentWorkingPanelProps) {
  const support = inputs.supportCondition.replace('-', ' ');
  const load = inputs.loadPattern.replace('-', ' ');
  const derivation = buildBeamDerivation(result, inputs);
  const outputUnit = inputs.unitSystem === 'metric' ? 'mm' : 'in';
  const mathValue = mathReview?.deflection === undefined ? 'waiting for review' : `${formatCalculationValue(mathReview.deflection)} ${outputUnit}`;
  const variance = mathReview?.variancePercent === undefined ? 'pending' : `${formatVariancePercent(mathReview.variancePercent)}%`;
  return (
    <View style={styles.workingPanel}>
      <Text style={styles.workingPanelKicker}>DETERMINISTIC CALCULATION TRACE</Text>
      <Text style={styles.workingPanelIntro}>Both displayed numbers are computed in code. OpenAI can add an advisory explanation but cannot change either result.</Text>
      <View style={styles.workingStep}>
        <View style={styles.workingStepNumber}><Text style={styles.workingStepNumberText}>01</Text></View>
        <View style={styles.workingStepCopy}>
          <Text style={styles.workingStepTitle}>PHYSICS SOLVER · CLOSED FORM</Text>
          <Text style={styles.workingStepBody}>Used the Euler–Bernoulli beam model for a {support} support with a {load} load.</Text>
          <Text style={styles.workingEquation}>{derivation.normalizedInputs}</Text>
          <Text style={styles.workingEquation}>{derivation.sectionProperties}</Text>
          <Text style={styles.workingEquation}>{derivation.physicsEquation}</Text>
          <Text style={styles.workingEquation}>{derivation.screeningEquation}</Text>
          <Text style={styles.workingStepResult}>Peak response: {formatCalculationValue(result.deflectionDisplay)} {outputUnit} · screening limit: {result.safetyLimitDisplay.toFixed(2)} {outputUnit}</Text>
        </View>
      </View>
      <View style={styles.workingStep}>
        <View style={styles.workingStepNumber}><Text style={styles.workingStepNumberText}>02</Text></View>
        <View style={styles.workingStepCopy}>
          <Text style={styles.workingStepTitle}>NUMERICAL AUDITOR · INDEPENDENT CHECK</Text>
          <Text style={styles.workingStepBody}>
            {tier !== 'premium'
              ? 'Locked for this tier. Premium activates the independent numerical comparison.'
              : mathReviewLoading
                ? 'The independent numerical check is still running.'
                : `Independent value: ${mathValue}. Difference from Physics: ${variance}.`}
          </Text>
          {tier === 'premium' && !mathReviewLoading ? <Text style={styles.workingEquation}>{derivation.mathEquation}</Text> : null}
          {tier === 'premium' && !mathReviewLoading && mathReview?.trace ? <Text style={styles.workingEquation}>{mathReview.trace}</Text> : null}
          {tier === 'premium' && !mathReviewLoading && mathReview?.deflection !== undefined ? (
            <Text style={styles.workingEquation}>
              {`Variance = |${formatCalculationValue(mathReview.deflection)} − ${formatCalculationValue(result.deflectionDisplay)}| / ${formatCalculationValue(result.deflectionDisplay)} × 100 = ${variance}`}
            </Text>
          ) : null}
        </View>
      </View>
      {tier === 'premium' ? (
        <View style={styles.workingStep}>
          <View style={styles.workingStepNumber}><Text style={styles.workingStepNumberText}>03</Text></View>
          <View style={styles.workingStepCopy}>
          <Text style={styles.workingStepTitle}>OPENAI · ADVISORY EXPLANATION</Text>
            <Text style={styles.workingStepBody}>{mathReviewLoading ? 'Reviewing whether the response has an obvious realism or hold-up concern.' : mathReview?.realismSummary ?? 'The advisory review will appear after the server response returns.'}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ConsensusBadge({ state, variancePercent }: { state: ConsensusState; variancePercent?: number }) {
  const verified = state === 'verified';
  const failed = state === 'failed';
  const title = verified ? 'VERIFIED CONSENSUS' : failed ? 'RECONCILIATION FAILED' : 'CONSENSUS IN PROGRESS';
  const detail = verified
    ? `VARIANCE ${formatVariancePercent(variancePercent ?? 0)}% · WITHIN 1% THRESHOLD`
    : failed
      ? `VARIANCE ${variancePercent === undefined ? '—' : `${formatVariancePercent(variancePercent)}%`} · REVIEW REQUIRED`
      : 'MATH AI AGENT IS RUNNING AN INDEPENDENT REVIEW';
  return (
    <View style={[styles.consensusBadge, verified ? styles.consensusVerified : failed ? styles.consensusFailed : styles.consensusPending]}>
      <View style={styles.consensusIcon}>
        <Feather name={verified ? 'check-circle' : failed ? 'alert-circle' : 'loader'} size={22} color={verified ? colors.dark.success : failed ? colors.dark.destructive : colors.dark.accent} />
      </View>
      <View style={styles.consensusCopy}>
        <Text style={[styles.consensusTitle, { color: verified ? colors.dark.success : failed ? colors.dark.destructive : colors.dark.accent }]}>{title}</Text>
        <Text style={styles.consensusDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function VisualGuide({ result, inputs, tier, mathSummary }: { result: BeamResult; inputs: BeamInputs; tier: PlanTier; mathSummary?: string }) {
  const guide = inputs.supportCondition === 'cantilever'
    ? 'The fixed root holds the beam while the free end carries the largest visible movement.'
    : 'The response is lowest at the supports and peaks toward the center of the span.';
  return (
    <View style={styles.guideCard}>
      <View style={styles.guideIcon}><Feather name="eye" size={17} color={colors.dark.accent} /></View>
      <View style={styles.guideCopy}>
        <View style={styles.guideTitleRow}>
          <Text style={styles.guideTitle}>VISUAL GUIDE</Text>
          <Text style={styles.guideTier}>ALL TIERS</Text>
        </View>
        <Text style={styles.guideBody}>{guide} Peak movement is {result.deflectionDisplay.toFixed(2)} {inputs.unitSystem === 'metric' ? 'mm' : 'in'}.</Text>
        <Text style={styles.guideFootnote}>
          The agents verify the response independently. AI guidance explains the bend and material context without changing the result.
        </Text>
        {tier === 'premium' && mathSummary ? <Text style={styles.guideAiText}>{mathSummary}</Text> : null}
        {tier === 'premium' && <Text style={styles.consensusNote}>MATH AI AGENT · PREMIUM INDEPENDENT REVIEW</Text>}
      </View>
    </View>
  );
}

function ResultCard({ result, inputs, tier, mathReview, mathReviewLoading }: { result: BeamResult; inputs: BeamInputs; tier: PlanTier; mathReview?: MathReview; mathReviewLoading: boolean }) {
  const [workingExpanded, setWorkingExpanded] = useState(false);
  const pass = result.safetyPass;
  const outputUnit = inputs.unitSystem === 'metric' ? 'mm' : 'in';
  const mathReady = Boolean(mathReview?.available && typeof mathReview.deflection === 'number');
  const consensusState: ConsensusState | null = tier !== 'premium'
    ? null
    : mathReviewLoading
      ? 'pending'
      : mathReady && mathReview?.consensus && (mathReview.variancePercent ?? 100) <= 1
        ? 'verified'
        : 'failed';
  return (
    <View style={[styles.resultCard, tier === 'premium' && styles.resultCardPremium]}>
      <View style={styles.resultHeader}>
        <View style={styles.resultHeaderCopy}>
          <Text style={styles.sectionKicker}>02 / DETERMINISTIC OUTPUT</Text>
          <Text style={styles.resultHeading}>CALCULATION RESULT</Text>
        </View>
        <View style={[styles.statusBadge, pass ? styles.statusPass : styles.statusFail]}>
          <View style={[styles.statusDot, !pass && styles.statusDotFail]} />
          <Text style={[styles.statusText, !pass && styles.statusTextFail]}>{pass ? 'WITHIN L/360' : 'REVIEW LOAD'}</Text>
        </View>
      </View>
      <Text style={styles.resultLabel}>MAXIMUM DEFLECTION</Text>
      <Text style={styles.resultValue}>
        {formatHeadlineDeflectionMm(result.deflectionM * 1000)}
        <Text style={styles.resultUnit}> mm</Text>
      </Text>
      {tier === 'premium' ? (
        <Text testID="lane-difference-nanometers" style={styles.laneDifference}>
          {mathReview?.deflectionM !== undefined
            ? `Lanes disagree by ${formatNanometers(Math.abs(mathReview.deflectionM - result.deflectionM) * 1_000_000_000)} nm`
            : 'Lane difference pending independent audit'}
        </Text>
      ) : null}
      {tier === 'premium' && consensusState ? <ConsensusBadge state={consensusState} variancePercent={mathReview?.variancePercent} /> : null}
      <View style={styles.resultMetricRow}>
        <View style={styles.resultMetric}>
          <Text style={styles.metricLabel}>SCREENING LIMIT</Text>
          <Text style={styles.metricValue}>{result.safetyLimitDisplay.toFixed(2)} {outputUnit}</Text>
        </View>
        <View style={styles.resultMetric}>
          <Text style={styles.metricLabel}>AGENT STATUS</Text>
          <Text style={[styles.metricValue, { color: colors.dark.accent }]}>{tier === 'premium' ? 'DUAL REVIEW' : 'PHYSICS ACTIVE'}</Text>
        </View>
      </View>
      <View style={styles.agentCompareGrid}>
        <View style={styles.agentMetricCard}>
          <View style={styles.agentMetricHeader}>
            <Feather name="cpu" size={15} color={colors.dark.primary} />
            <Text style={styles.agentMetricTitle}>PHYSICS SOLVER</Text>
          </View>
          <Text style={styles.agentMetricValue}>{formatCalculationValue(result.deflectionDisplay)}<Text style={styles.agentMetricUnit}> {outputUnit}</Text></Text>
          <Text style={styles.agentMetricStatus}>PRIMARY RESPONSE</Text>
        </View>
        <View style={[styles.agentMetricCard, tier !== 'premium' && styles.agentMetricCardLocked]}>
          <View style={styles.agentMetricHeader}>
            <Feather name={tier === 'premium' ? 'bar-chart-2' : 'lock'} size={15} color={tier === 'premium' ? colors.dark.accent : colors.dark.mutedForeground} />
            <Text style={[styles.agentMetricTitle, tier !== 'premium' && styles.agentMetricTitleLocked]}>NUMERICAL AUDITOR</Text>
          </View>
          <Text style={[styles.agentMetricValue, tier !== 'premium' && styles.agentMetricValueLocked]}>
            {tier !== 'premium' ? '—' : mathReview?.deflection === undefined ? '…' : formatCalculationValue(mathReview.deflection)}
            <Text style={styles.agentMetricUnit}>{tier !== 'premium' || mathReview?.deflection === undefined ? '' : ` ${outputUnit}`}</Text>
          </Text>
          <Text style={[styles.agentMetricStatus, { color: tier !== 'premium' ? colors.dark.mutedForeground : mathReady ? colors.dark.success : colors.dark.mutedForeground }]}>
            {tier !== 'premium' ? 'PREMIUM REQUIRED' : mathReviewLoading ? 'RUNNING INDEPENDENTLY' : mathReady ? 'INDEPENDENT CHECK COMPLETE' : 'READY TO REVIEW'}
          </Text>
        </View>
      </View>
      <View style={styles.agentReviewPanel}>
        <Text style={styles.agentReviewLabel}>NUMERICAL AUDIT</Text>
        <Text style={styles.agentReviewText}>
          {tier !== 'premium'
            ? 'Upgrade to Premium to activate the independent mathematical review and consensus check.'
            : mathReviewLoading
              ? 'Math AI Agent is checking the completed result independently…'
              : mathReview?.summary ?? 'Waiting for the independent Math AI Agent review.'}
        </Text>
      </View>
      {tier === 'premium' ? <RealismReviewCard mathReview={mathReview} loading={mathReviewLoading} /> : null}
      <Pressable
        testID="agent-working-toggle"
        onPress={() => setWorkingExpanded((current) => !current)}
        style={({ pressed }) => [styles.workingToggle, pressed && styles.pressed]}
      >
        <View style={styles.workingToggleCopy}>
          <View style={styles.workingToggleIcon}><Feather name="terminal" size={14} color={colors.dark.accent} /></View>
          <View>
            <Text style={styles.workingToggleTitle}>SEE HOW THE AGENTS WORKED</Text>
            <Text style={styles.workingToggleSubtitle}>Readable calculation trace</Text>
          </View>
        </View>
        <Feather name={workingExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.dark.accent} />
      </Pressable>
      {workingExpanded ? <AgentWorkingPanel result={result} inputs={inputs} tier={tier} mathReview={mathReview} mathReviewLoading={mathReviewLoading} /> : null}
      <VisualGuide result={result} inputs={inputs} tier={tier} mathSummary={mathReviewLoading ? undefined : mathReview?.summary} />
    </View>
  );
}

function TierCard({
  tier,
  activeTier,
  price,
  available,
  onPurchase,
  isPurchasing,
}: {
  tier: PlanTier;
  activeTier: PlanTier;
  price: string;
  available: boolean;
  onPurchase: (tier: PlanTier) => void;
  isPurchasing: boolean;
}) {
  const config = TIER_CONFIG[tier];
  const active = activeTier === tier;
  const unavailable = tierRank[tier] < tierRank[activeTier];
  return (
    <View style={[styles.tierCard, active && { borderColor: config.color }, tier === 'premium' && styles.tierCardPremium]}>
      <View style={styles.tierCardTop}>
        <View>
          <Text style={[styles.tierName, { color: config.color }]}>{config.name}</Text>
          <Text style={styles.tierDetail}>{config.feature}</Text>
        </View>
        {active ? <View style={styles.activePill}><Text style={styles.activePillText}>ACTIVE</Text></View> : null}
      </View>
      <View style={styles.tierCardMeta}>
        <Text style={styles.tierPrice}>{tier === 'freemium' ? 'FREE' : price}</Text>
        <Text style={styles.tierLimit}>{formatLimit(config.limit)} {config.limit === 1 ? 'CALC' : 'CALCS'} / MONTH</Text>
      </View>
      <Text style={styles.tierCardDetail}>{config.detail}</Text>
      {!active && tier !== 'freemium' && !unavailable && available ? (
        <Pressable testID={`${tier}-upgrade-button`} onPress={() => onPurchase(tier)} disabled={isPurchasing} style={styles.tierAction}>
          {isPurchasing ? <ActivityIndicator color={colors.dark.primaryForeground} size="small" /> : <Text style={styles.tierActionText}>UNLOCK {config.name}</Text>}
        </Pressable>
      ) : null}
      {!active && tier !== 'freemium' && !unavailable && !available ? (
        <Text style={styles.billingHint}>No matching {config.name} product is available in the current RevenueCat offering.</Text>
      ) : null}
    </View>
  );
}

function PlanModal({
  visible,
  onClose,
  activeTier,
  priceForTier,
  isTierAvailable,
  billingError,
  onPurchase,
  onRestore,
  isPurchasing,
  configured,
  message,
}: {
  visible: boolean;
  onClose: () => void;
  activeTier: PlanTier;
  priceForTier: (tier: 'promium' | 'premium') => string;
  isTierAvailable: (tier: 'promium' | 'premium') => boolean;
  billingError?: string;
  onPurchase: (tier: PlanTier) => void;
  onRestore: () => void;
  isPurchasing: boolean;
  configured: boolean;
  message: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.planModal}>
          <ScrollView style={styles.planModalScroll} contentContainerStyle={styles.planModalContent} showsVerticalScrollIndicator={false}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <View style={styles.modalTitleCopy}>
                <Text style={styles.sectionKicker}>ACCESS CONTROL</Text>
                <Text style={styles.modalTitle}>Choose your plan.</Text>
              </View>
              <Pressable onPress={onClose} style={styles.closeButton}>
                <Feather name="x" size={19} color={colors.dark.text} />
              </Pressable>
            </View>
            <Text style={styles.modalBody}>Every tier gets deterministic Physics AI. Premium adds an independent Math AI lane, giving each decision a second set of eyes.</Text>
            <TierCard tier="freemium" activeTier={activeTier} price="FREE" available onPurchase={onPurchase} isPurchasing={isPurchasing} />
            <TierCard tier="promium" activeTier={activeTier} price={priceForTier('promium')} available={isTierAvailable('promium')} onPurchase={onPurchase} isPurchasing={isPurchasing} />
            <TierCard tier="premium" activeTier={activeTier} price={priceForTier('premium')} available={isTierAvailable('premium')} onPurchase={onPurchase} isPurchasing={isPurchasing} />
            {!configured && <Text style={styles.billingHint}>RevenueCat is not configured yet. The calculator remains available; upgrades activate when the current offering is connected.</Text>}
            {billingError ? <Text style={styles.billingHint}>RevenueCat could not load the current offering: {billingError}</Text> : null}
            {message ? <Text style={styles.errorText}>{message}</Text> : null}
            <Pressable onPress={onRestore} style={styles.restoreButton}>
              <Feather name="refresh-cw" size={14} color={colors.dark.accent} />
              <Text style={styles.restoreText}>Restore purchases</Text>
            </Pressable>
            <Text style={styles.modalFootnote}>Test purchases are handled by RevenueCat’s Test Store.</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function HistoryList({ history, tier }: { history: HistoryItem[]; tier: PlanTier }) {
  const visibleHistory = tier === 'premium' ? history.slice(0, 8) : history.slice(0, 3);
  return (
    <View style={styles.historyCard}>
      <View style={styles.historyHeader}>
        <View>
          <Text style={styles.sectionKicker}>SAVED ARCHIVE</Text>
          <Text style={styles.historyTitle}>{tier === 'premium' ? 'FULL HISTORY' : 'RECENT CHECKS'}</Text>
        </View>
        <Feather name="clock" size={18} color={colors.dark.accent} />
      </View>
      {visibleHistory.length === 0 ? (
        <Text style={styles.historyEmpty}>Your solved scenarios will appear here on this device.</Text>
      ) : (
        visibleHistory.map((item) => (
          <View key={item.id} style={styles.historyRow}>
            <View style={styles.historyRowIcon}><Feather name="activity" size={14} color={colors.dark.primary} /></View>
            <View style={styles.historyRowCopy}>
              <Text style={styles.historyRowTitle}>{item.material}</Text>
              <Text style={styles.historyRowMeta}>{new Date(item.createdAt).toLocaleDateString()} · {item.inputs.supportCondition}</Text>
            </View>
            <Text style={styles.historyValue}>{item.result.deflectionDisplay.toFixed(2)} {item.inputs.unitSystem === 'metric' ? 'mm' : 'in'}</Text>
          </View>
        ))
      )}
      {tier !== 'premium' && history.length > 3 ? <Text style={styles.historyLock}>PREMIUM UNLOCKS FULL HISTORY</Text> : null}
    </View>
  );
}

function DrawerAction({
  icon,
  title,
  subtitle,
  onPress,
  disabled = false,
  destructive = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.drawerAction, disabled && styles.drawerActionDisabled, pressed && styles.drawerActionPressed]}
    >
      <View style={[styles.drawerActionIcon, destructive && styles.drawerActionIconDestructive]}>
        <Feather name={icon} size={16} color={disabled ? colors.dark.mutedForeground : destructive ? colors.dark.primary : colors.dark.accent} />
      </View>
      <View style={styles.drawerActionCopy}>
        <Text style={[styles.drawerActionTitle, disabled && styles.drawerActionTitleDisabled]}>{title}</Text>
        <Text style={styles.drawerActionSubtitle}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={disabled ? colors.dark.mutedForeground : colors.dark.borderStrong} />
    </Pressable>
  );
}

function SideDrawer({
  visible,
  onClose,
  activeTier,
  usageCount,
  usageLimit,
  unitSystem,
  resultReady,
  historyCount,
  onNewCalculation,
  onCalculateAgain,
  onOpenHistory,
  onOpenPlans,
  onToggleUnits,
  onReset,
}: {
  visible: boolean;
  onClose: () => void;
  activeTier: PlanTier;
  usageCount: number;
  usageLimit: number;
  unitSystem: 'metric' | 'imperial';
  resultReady: boolean;
  historyCount: number;
  onNewCalculation: () => void;
  onCalculateAgain: () => void;
  onOpenHistory: () => void;
  onOpenPlans: () => void;
  onToggleUnits: () => void;
  onReset: () => void;
}) {
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const [mounted, setMounted] = useState(visible);
  const scrimOpacity = translateX.interpolate({ inputRange: [-DRAWER_WIDTH, 0], outputRange: [0, 0.62], extrapolate: 'clamp' });

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(translateX, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else if (mounted) {
      Animated.timing(translateX, {
        toValue: -DRAWER_WIDTH,
        duration: 210,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [mounted, translateX, visible]);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.drawerScrim, { opacity: scrimOpacity }]} />
        <Pressable testID="drawer-scrim" onPress={onClose} style={StyleSheet.absoluteFill} />
        <Animated.View style={[styles.sideDrawer, { width: DRAWER_WIDTH, transform: [{ translateX }] }]}>
          <ScrollView contentContainerStyle={styles.drawerContent} showsVerticalScrollIndicator={false}>
            <View style={styles.drawerHeader}>
              <View style={styles.drawerBrandMark}><Feather name="activity" size={18} color={colors.dark.primaryForeground} /></View>
              <View style={styles.drawerHeaderCopy}>
                <Text style={styles.drawerKicker}>CONTROL CENTER</Text>
                <Text style={styles.drawerTitle}>NEOMETRIST AI</Text>
              </View>
              <Pressable testID="drawer-close" onPress={onClose} style={styles.drawerClose}>
                <Feather name="x" size={18} color={colors.dark.text} />
              </Pressable>
            </View>

            <View style={styles.drawerAccessCard}>
              <View style={styles.drawerAccessTopline}>
                <Text style={styles.drawerAccessLabel}>CURRENT ACCESS</Text>
                <TierBadge tier={activeTier} compact />
              </View>
              <Text style={styles.drawerAccessTier}>{TIER_CONFIG[activeTier].name}</Text>
              <Text style={styles.drawerAccessMeta}>
                {usageLimit === Infinity ? `${usageCount} calculations · unlimited plan` : `${usageCount} of ${usageLimit} calculations this month`}
              </Text>
            </View>

            <Text style={styles.drawerSectionLabel}>WORKSPACE</Text>
            <DrawerAction icon="plus-circle" title="New calculation" subtitle="Clear the current result and start fresh" onPress={onNewCalculation} />
            <DrawerAction icon="refresh-cw" title="Calculate again" subtitle={resultReady ? 'Run the current beam inputs again' : 'Solve a beam first'} onPress={onCalculateAgain} disabled={!resultReady} />
            <DrawerAction icon="archive" title="Saved archive" subtitle={`${historyCount} saved check${historyCount === 1 ? '' : 's'} on this device`} onPress={onOpenHistory} />

            <Text style={styles.drawerSectionLabel}>ACCESS & PREFERENCES</Text>
            <DrawerAction icon="layers" title="Plans and agents" subtitle="Compare tiers and unlock independent review" onPress={onOpenPlans} />
            <Pressable onPress={onToggleUnits} style={({ pressed }) => [styles.drawerPreferenceRow, pressed && styles.drawerActionPressed]}>
              <View style={styles.drawerActionIcon}><Feather name="sliders" size={16} color={colors.dark.accent} /></View>
              <View style={styles.drawerActionCopy}>
                <Text style={styles.drawerActionTitle}>Unit system</Text>
                <Text style={styles.drawerActionSubtitle}>Switch the input fields and display units</Text>
              </View>
              <View style={styles.drawerUnitValue}><Text style={styles.drawerUnitValueText}>{unitSystem === 'metric' ? 'METRIC' : 'IMPERIAL'}</Text></View>
            </Pressable>
            <DrawerAction icon="trash-2" title="Reset local workspace" subtitle="Clear saved checks and return to Freemium" onPress={onReset} destructive />

            <View style={styles.drawerFooter}>
              <View style={styles.drawerFooterRow}>
                <View style={styles.drawerLiveDot} />
                <Text style={styles.drawerFooterTitle}>LOCAL-FIRST CALCULATOR</Text>
              </View>
              <Text style={styles.drawerFooterText}>Inputs, results, and saved checks stay on this device. AI review only runs when a Premium check is requested.</Text>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function HistoryModal({ visible, onClose, history, tier }: { visible: boolean; onClose: () => void; history: HistoryItem[]; tier: PlanTier }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.historyModal}>
          <View style={styles.modalTitleRow}>
            <View style={styles.modalTitleCopy}>
              <Text style={styles.sectionKicker}>SAVED ARCHIVE</Text>
              <Text style={styles.modalTitle}>{tier === 'premium' ? 'Full history' : 'Recent checks'}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Feather name="x" size={19} color={colors.dark.text} />
            </Pressable>
          </View>
          <HistoryList history={history} tier={tier} />
        </View>
      </View>
    </Modal>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const subscription = useSubscription();
  const [inputs, setInputs] = useState<BeamInputs>(initialInputs);
  const [inputDrafts, setInputDrafts] = useState<InputDrafts>(() => draftsFor(initialInputs));
  const [material, setMaterial] = useState<Material>(MATERIALS[0]);
  const [result, setResult] = useState<BeamResult>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [usageCount, setUsageCount] = useState(0);
  const [usageMonth, setUsageMonth] = useState('');
  const [selector, setSelector] = useState<Selector>(null);
  const [planVisible, setPlanVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [error, setError] = useState('');
  const [demoReset, setDemoReset] = useState(false);
  const [mathReview, setMathReview] = useState<MathReview>();
  const [mathReviewLoading, setMathReviewLoading] = useState(false);

  const activeTier: PlanTier = demoReset ? 'freemium' : subscription.planTier;
  const tierConfig = TIER_CONFIG[activeTier];
  const monthKey = new Date().toISOString().slice(0, 7);
  const limitReached = tierConfig.limit !== Infinity && usageCount >= tierConfig.limit;
  const premiumLocked = subscription.isPremium && !demoReset;

  useEffect(() => {
    Promise.all([AsyncStorage.getItem('neometrist-history'), AsyncStorage.getItem('neometrist-usage')]).then(([rawHistory, rawUsage]) => {
      if (rawHistory) {
        try { setHistory(JSON.parse(rawHistory) as HistoryItem[]); } catch { setHistory([]); }
      }
      if (rawUsage) {
        try {
          const stored = JSON.parse(rawUsage) as { month: string; count: number };
          if (stored.month === monthKey) {
            setUsageMonth(stored.month);
            setUsageCount(stored.count);
          }
        } catch {
          setUsageCount(0);
        }
      }
    });
  }, [monthKey]);

  const units = useMemo(
    () => inputs.unitSystem === 'metric'
      ? { span: 'M', section: 'M', load: inputs.loadPattern === 'udl' ? 'KN/M' : 'KN', modulus: 'GPA', output: 'MM' }
      : { span: 'FT', section: 'IN', load: inputs.loadPattern === 'udl' ? 'KIP/FT' : 'KIP', modulus: 'KSI', output: 'IN' },
    [inputs.loadPattern, inputs.unitSystem],
  );

  const updateNumber = (key: NumericInputKey, value: string) => {
    const normalized = value.replace(',', '.');
    if (!/^\d*(\.\d*)?$/.test(normalized)) return;
    setInputDrafts((current) => ({ ...current, [key]: normalized }));
    const numericValue = normalized === '' || normalized === '.' ? 0 : Number(normalized);
    setInputs((current) => ({ ...current, [key]: Number.isFinite(numericValue) ? numericValue : 0 }));
    clearResult();
  };

  const clearResult = () => {
    setResult(undefined);
    setMathReview(undefined);
    setMathReviewLoading(false);
    setError('');
  };

  const startNewCalculation = () => {
    clearResult();
    setMenuVisible(false);
  };

  const openHistory = () => {
    setMenuVisible(false);
    setHistoryVisible(true);
  };

  const openPlans = () => {
    setMenuVisible(false);
    setPlanVisible(true);
  };

  const toggleUnits = () => {
    changeUnits(inputs.unitSystem === 'metric' ? 'imperial' : 'metric');
  };

  const requestTier = (requiredTier: PlanTier, label: string) => {
    if (!tierIsAvailable(requiredTier, activeTier)) {
      setError(`${label} is a ${TIER_CONFIG[requiredTier].name} feature. Open plans to unlock it.`);
      setPlanVisible(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return false;
    }
    return true;
  };

  const applyPreset = (preset: (typeof presets)[number]) => {
    if (!requestTier(preset.tier, preset.label)) return;
    const next = { ...inputs, ...preset.values };
    setInputs(next);
    setInputDrafts(draftsFor(next));
    const nextMaterial = MATERIALS.find((item) => item.label === preset.material) ?? MATERIALS[0];
    setMaterial(nextMaterial);
    clearResult();
    Haptics.selectionAsync();
  };

  const changeUnits = (unitSystem: 'metric' | 'imperial') => {
    if (unitSystem === inputs.unitSystem) return;
    const toImperial = unitSystem === 'imperial';
    const next = {
      ...inputs,
      unitSystem,
      span: Number((inputs.span * (toImperial ? 3.28084 : 0.3048)).toFixed(3)),
      width: Number((inputs.width * (toImperial ? 39.3701 : 0.0254)).toFixed(3)),
      depth: Number((inputs.depth * (toImperial ? 39.3701 : 0.0254)).toFixed(3)),
      appliedLoad: Number((inputs.appliedLoad * (toImperial ? 0.224809 : 4.44822)).toFixed(3)),
      elasticModulus: Number((inputs.elasticModulus * (toImperial ? 145.038 : 0.00689476)).toFixed(2)),
    } as BeamInputs;
    setInputs(next);
    setInputDrafts(draftsFor(next));
    clearResult();
  };

  const resetDemo = async () => {
    setInputs(initialInputs);
    setInputDrafts(draftsFor(initialInputs));
    setMaterial(MATERIALS[0]);
    setResult(undefined);
    setMathReview(undefined);
    setMathReviewLoading(false);
    setError('');
    setHistory([]);
    setUsageCount(0);
    setUsageMonth(monthKey);
    setDemoReset(true);
    setMenuVisible(false);
    await AsyncStorage.multiRemove(['neometrist-history', 'neometrist-usage']);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const calculate = async () => {
    if (limitReached) {
      setError(`${tierConfig.name} has used its ${tierConfig.limit} monthly calculations. Open plans to upgrade.`);
      setPlanVisible(true);
      return;
    }
    try {
      setError('');
      const nextResult = calculateBeam(inputs);
      const resultWithInputs = { ...nextResult, inputs } as BeamResult & { inputs: BeamInputs };
      setResult(resultWithInputs);
      setMathReview(activeTier === 'premium'
        ? {
            summary: 'The independent numerical audit is starting.',
            consensus: false,
            available: false,
          }
        : undefined);
      setMathReviewLoading(activeTier === 'premium');
      const nextHistory: HistoryItem[] = [
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), material: material.label, result: resultWithInputs, inputs },
        ...history,
      ].slice(0, activeTier === 'premium' ? 200 : 12);
      const nextCount = usageMonth === monthKey ? usageCount + 1 : 1;
      setHistory(nextHistory);
      setUsageCount(nextCount);
      setUsageMonth(monthKey);
      await AsyncStorage.setItem('neometrist-history', JSON.stringify(nextHistory));
      await AsyncStorage.setItem('neometrist-usage', JSON.stringify({ month: monthKey, count: nextCount }));
      if (activeTier === 'premium') {
        const mathAudit = calculateMathAgentDeflection(inputs);
        const mathDeflection = mathAudit.deflectionDisplay;
        const variancePercent = nextResult.deflectionDisplay === 0
          ? mathDeflection === 0 ? 0 : Infinity
          : Math.abs(mathDeflection - nextResult.deflectionDisplay) / Math.abs(nextResult.deflectionDisplay) * 100;
        const consensus = variancePercent <= 1;
        const derivation = buildBeamDerivation(nextResult, inputs);
        setMathReview({
          summary: 'Independent numerical calculation complete. An advisory explanation is optional.',
          deflection: mathDeflection,
          deflectionM: mathAudit.deflectionM,
          curve: mathAudit.curve,
          variancePercent,
          consensus,
          available: true,
          method: mathAudit.method,
          segments: mathAudit.segments,
          coarseSegments: mathAudit.coarseSegments,
          convergencePercent: mathAudit.convergencePercent,
          trace: mathAudit.trace,
        });
        try {
          const reviewPayload = await reviewBeamWithMathAgent({
            tier: activeTier,
            deflection: nextResult.deflectionDisplay,
            mathDeflection,
            variancePercent: Number.isFinite(variancePercent) ? variancePercent.toString() : 'undefined',
            consensus,
            physicsTrace: [
              derivation.normalizedInputs,
              derivation.sectionProperties,
              derivation.physicsEquation,
              derivation.screeningEquation,
            ].join(' · '),
            mathTrace: mathAudit.trace,
            safetyLimit: nextResult.safetyLimitDisplay,
            safetyPass: nextResult.safetyPass,
            material: material.label,
            supportCondition: inputs.supportCondition,
            loadPattern: inputs.loadPattern,
            elasticModulus: inputs.elasticModulus,
            span: inputs.span,
            width: inputs.width,
            depth: inputs.depth,
            appliedLoad: inputs.appliedLoad,
            unitSystem: inputs.unitSystem,
          });
          if (reviewPayload.summary) {
            setMathReview((current) => ({
              ...current,
              summary: reviewPayload.summary,
              realismStatus: reviewPayload.realismStatus,
              realismSummary: reviewPayload.realismSummary,
              deflection: mathDeflection,
              deflectionM: mathAudit.deflectionM,
              curve: mathAudit.curve,
              variancePercent,
              consensus,
              available: true,
              method: mathAudit.method,
              segments: mathAudit.segments,
              coarseSegments: mathAudit.coarseSegments,
              convergencePercent: mathAudit.convergencePercent,
              trace: mathAudit.trace,
            }));
          }
        } catch {
          setMathReview((current) => ({
            ...current,
            summary: 'The advisory explanation is unavailable. Both deterministic calculation results remain available.',
            deflection: mathDeflection,
            deflectionM: mathAudit.deflectionM,
            curve: mathAudit.curve,
            variancePercent,
            consensus,
            available: true,
            method: mathAudit.method,
            segments: mathAudit.segments,
            coarseSegments: mathAudit.coarseSegments,
            convergencePercent: mathAudit.convergencePercent,
            trace: mathAudit.trace,
          }));
        } finally {
          setMathReviewLoading(false);
        }
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check the inputs and try again.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const openMaterialSelector = () => setSelector('material');
  const currentSupport = supportOptions.find((item) => item.key === inputs.supportCondition)?.label ?? '';
  const currentLoad = loadOptions.find((item) => item.key === inputs.loadPattern)?.label ?? '';
  const priceForTier = (tier: 'promium' | 'premium') => subscription.priceForTier(tier);

  const selectItem = (item: any) => {
    if (selector === 'support') setInputs((current) => ({ ...current, supportCondition: item.key }));
    if (selector === 'load') setInputs((current) => ({ ...current, loadPattern: item.key }));
    if (selector === 'material') {
      if (!tierIsAvailable(item.tier, activeTier)) {
        setSelector(null);
        setPlanVisible(true);
        setError(`${item.label} is reserved for the ${TIER_CONFIG[item.tier as PlanTier].name} tier.`);
        return;
      }
      setMaterial(item as Material);
      const next = { ...inputs, elasticModulus: inputs.unitSystem === 'metric' ? item.metricE : item.imperialE };
      setInputs(next);
      setInputDrafts(draftsFor(next));
    }
    setSelector(null);
    clearResult();
  };

  return (
    <View style={styles.screen}>
      <Header onMenu={() => setMenuVisible((value) => !value)} />
      <KeyboardAwareScrollViewCompat
        bottomOffset={88}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 15, paddingBottom: insets.bottom + 46 }]}
      >
        <View style={styles.planBar}>
          <View style={styles.planIdentity}>
            <View style={styles.planBrandMark}>
              <Feather name="activity" size={16} color={colors.dark.primaryForeground} />
            </View>
            <View style={styles.planBrandCopy}>
            <Text style={styles.planBrandName}>NEOMETRIST AI</Text>
            <Text style={styles.planCount}>{tierConfig.limit === Infinity ? `${usageCount} CALCULATIONS / UNLIMITED` : `${usageCount} / ${tierConfig.limit} CALCULATIONS THIS MONTH`}</Text>
            </View>
          </View>
          {!premiumLocked ? (
            <Pressable testID="plan-switcher" onPress={() => setPlanVisible(true)} style={styles.planCta}>
              <Text style={styles.planCtaText}>VIEW PLANS</Text>
              <Feather name="arrow-up-right" size={15} color={colors.dark.accent} />
            </Pressable>
          ) : (
            <View style={styles.planStatusPill}>
              <View style={styles.planStatusDot} />
              <Text style={styles.planStatusText}>ACTIVE</Text>
            </View>
          )}
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>DUAL STRUCTURAL INTELLIGENCE</Text>
          <Text style={styles.heroTitle}>See it twice.<Text style={styles.heroAccent}> Decide with clarity.</Text></Text>
          <Text style={styles.heroSubtitle}>Neometrist AI is a second set of eyes for engineering decisions: one lane solves the physics, the other checks the math.</Text>
        </View>

        <View style={styles.intelligenceBanner}>
          <View style={styles.intelligenceIcon}>
            <Feather name="git-merge" size={18} color={colors.dark.primaryForeground} />
          </View>
          <View style={styles.intelligenceCopy}>
            <Text style={styles.intelligenceTitle}>TWO LENSES. ONE CLEARER CALL.</Text>
            <Text style={styles.intelligenceBody}>Deterministic calculation first. Independent review when your tier includes it.</Text>
          </View>
          <View style={styles.intelligenceSignal}>
            <View style={styles.intelligenceSignalDot} />
            <Text style={styles.intelligenceSignalText}>READY</Text>
          </View>
        </View>

        <BeamVisualizer result={result} inputs={inputs} />

        <View style={styles.presetCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.sectionKicker}>SCENARIO STARTERS</Text>
              <Text style={styles.cardTitle}>Choose a domain</Text>
            </View>
            <Feather name="command" size={20} color={colors.dark.primary} />
          </View>
          <Text style={styles.cardCaption}>Locked scenarios open the plan sheet. Your inputs remain editable after selection.</Text>
          <View style={styles.presetWrap}>
            {presets.map((preset) => {
              const available = tierIsAvailable(preset.tier, activeTier);
              return (
                <Pressable key={preset.key} onPress={() => applyPreset(preset)} style={({ pressed }) => [styles.presetChip, !available && styles.presetChipLocked, pressed && styles.pressed]}>
                  <Feather name={available ? preset.icon : 'lock'} size={15} color={available ? colors.dark.accent : colors.dark.mutedForeground} />
                  <Text style={[styles.presetText, !available && styles.presetTextLocked]}>{preset.label}</Text>
                  {!available ? <Text style={styles.presetTier}>{TIER_CONFIG[preset.tier].short}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionKicker}>INPUT SCENARIO</Text>
              <Text style={styles.cardTitle}>Set the boundary conditions</Text>
            </View>
            <Pressable onPress={resetDemo} style={styles.resetIconButton}>
              <Feather name="rotate-ccw" size={15} color={colors.dark.mutedForeground} />
            </Pressable>
          </View>
          <SelectField label="Support condition" value={currentSupport} onPress={() => setSelector('support')} />
          <SelectField label="Load pattern" value={currentLoad} onPress={() => setSelector('load')} />
          <SelectField label="Material" value={material.label} onPress={openMaterialSelector} locked={tierRank[material.tier] > tierRank[activeTier]} />
          <Text style={styles.helperText}>MATERIAL ACCESS: {TIER_CONFIG[material.tier].name} · {material.domain.toUpperCase()}</Text>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}><Field label="Elastic modulus" unit={units.modulus} value={inputDrafts.elasticModulus} onChangeText={(value) => updateNumber('elasticModulus', value)} testID="elastic-modulus" /></View>
            <View style={styles.fieldHalf}><Field label="Span length" unit={units.span} value={inputDrafts.span} onChangeText={(value) => updateNumber('span', value)} testID="span-length" /></View>
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}><Field label="Section width" unit={units.section} value={inputDrafts.width} onChangeText={(value) => updateNumber('width', value)} testID="section-width" /></View>
            <View style={styles.fieldHalf}><Field label="Section depth" unit={units.section} value={inputDrafts.depth} onChangeText={(value) => updateNumber('depth', value)} testID="section-depth" /></View>
          </View>
          <Field label="Applied load" unit={units.load} value={inputDrafts.appliedLoad} onChangeText={(value) => updateNumber('appliedLoad', value)} testID="applied-load" />
          <View style={styles.unitHeader}><Text style={styles.fieldLabel}>Unit system</Text><Text style={styles.fieldUnit}>NORMALIZED BEFORE SOLVE</Text></View>
          <View style={styles.unitToggle}>
            <Pressable onPress={() => changeUnits('metric')} style={[styles.unitOption, inputs.unitSystem === 'metric' && styles.unitSelected]}><Text style={[styles.unitText, inputs.unitSystem === 'metric' && styles.unitTextSelected]}>METRIC</Text></Pressable>
            <Pressable onPress={() => changeUnits('imperial')} style={[styles.unitOption, inputs.unitSystem === 'imperial' && styles.unitSelected]}><Text style={[styles.unitText, inputs.unitSystem === 'imperial' && styles.unitTextSelected]}>IMPERIAL</Text></Pressable>
          </View>
          <AgentAccessPanel tier={activeTier} mathReview={mathReview} mathReviewLoading={mathReviewLoading} />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable testID="calculate-button" onPress={calculate} style={({ pressed }) => [styles.calculateButton, pressed && styles.calculatePressed]}>
            <View><Text style={styles.calculateEyebrow}>RUN AI ANALYSIS</Text><Text style={styles.calculateText}>CALCULATE DEFLECTION</Text></View>
            <View style={styles.calculateArrow}><Feather name="arrow-up-right" size={20} color={colors.dark.primaryForeground} /></View>
          </Pressable>
        </View>

        {result ? (
          <>
            <ResultCard result={result} inputs={inputs} tier={activeTier} mathReview={mathReview} mathReviewLoading={mathReviewLoading} />
            <DeflectionGraph result={result} mathReview={mathReview} tier={activeTier} />
          </>
        ) : (
          <View style={styles.emptyCard}>
            <View style={styles.emptyTopline}><View style={styles.emptyIcon}><Feather name="activity" size={21} color={colors.dark.primary} /></View><TierBadge tier={activeTier} compact /></View>
            <Text style={styles.sectionKicker}>AI AGENT OUTPUT</Text>
            <Text style={styles.emptyTitle}>WAITING FOR A SCENARIO</Text>
            <Text style={styles.emptyBody}>Run the AI analysis to see the beam bend, agent statuses, and mathematical response graph.</Text>
          </View>
        )}

        <HistoryList history={history} tier={activeTier} />

        <View style={styles.disclaimerCard}>
          <Feather name="alert-triangle" size={18} color={colors.dark.primary} />
          <View style={styles.disclaimerCopy}>
            <Text style={styles.disclaimerTitle}>Preliminary check, not a sign-off.</Text>
            <Text style={styles.disclaimerBody}>Validate boundary conditions, load paths, material data, and governing code limits before making a construction decision.</Text>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>

      <PlanModal
        visible={planVisible}
        onClose={() => setPlanVisible(false)}
         activeTier={activeTier}
        priceForTier={priceForTier}
        isTierAvailable={subscription.isTierAvailable}
        billingError={subscription.billingError}
        configured={subscription.configured}
        message={error}
        isPurchasing={subscription.isPurchasing}
        onPurchase={async (tier) => {
          if (tier === 'freemium') return;
          try {
            setError('');
            setDemoReset(false);
            await subscription.purchaseTier(tier);
            setPlanVisible(false);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'This plan could not be purchased yet.');
          }
        }}
        onRestore={async () => {
          try {
            setError('');
            await subscription.restore();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Purchases could not be restored.');
          }
        }}
      />

      <SideDrawer
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        activeTier={activeTier}
        usageCount={usageCount}
        usageLimit={tierConfig.limit}
        unitSystem={inputs.unitSystem}
        resultReady={Boolean(result)}
        historyCount={history.length}
        onNewCalculation={startNewCalculation}
        onCalculateAgain={() => { setMenuVisible(false); void calculate(); }}
        onOpenHistory={openHistory}
        onOpenPlans={openPlans}
        onToggleUnits={toggleUnits}
        onReset={resetDemo}
      />

      <HistoryModal visible={historyVisible} onClose={() => setHistoryVisible(false)} history={history} tier={activeTier} />

      <Modal visible={selector !== null} transparent animationType="fade" onRequestClose={() => setSelector(null)}>
        <Pressable style={styles.selectorBackdrop} onPress={() => setSelector(null)}>
          <View style={styles.selectorCard} onStartShouldSetResponder={() => true}>
            <View style={styles.selectorHeader}><Text style={styles.sectionKicker}>SELECT {selector?.toUpperCase()}</Text><Pressable onPress={() => setSelector(null)}><Feather name="x" size={18} color={colors.dark.mutedForeground} /></Pressable></View>
            {(selector === 'support' ? supportOptions : selector === 'load' ? loadOptions : MATERIALS).map((item: any) => {
              const key = 'key' in item ? item.key : item.label;
              const label = item.label;
              const available = selector !== 'material' || tierIsAvailable(item.tier, activeTier);
              return (
                <Pressable key={key} onPress={() => selectItem(item)} style={[styles.selectorRow, !available && styles.selectorRowLocked]}>
                  <View><Text style={[styles.selectorText, !available && styles.selectorTextLocked]}>{label}</Text>{selector === 'material' ? <Text style={styles.selectorMeta}>{item.domain} · {TIER_CONFIG[item.tier as PlanTier].name}</Text> : null}</View>
                  <Feather name={available ? 'chevron-right' : 'lock'} size={16} color={available ? colors.dark.mutedForeground : colors.dark.primary} />
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.dark.background },
  header: { minHeight: 68, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.dark.border, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.dark.header },
  iconButton: { width: 40, height: 40, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dark.card },
  brand: { flex: 1 },
  brandName: { color: colors.dark.text, letterSpacing: 2.8, fontSize: 14, fontWeight: '800', fontFamily: 'monospace' },
  brandSubline: { color: colors.dark.mutedForeground, letterSpacing: 1.25, fontSize: 8, marginTop: 4, fontFamily: 'monospace' },
  liveMark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 7, backgroundColor: colors.dark.success },
  liveText: { color: colors.dark.mutedForeground, letterSpacing: 1.5, fontSize: 10, fontWeight: '700' },
  content: { paddingHorizontal: 16, gap: 14 },
  planBar: { backgroundColor: colors.dark.card, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 18, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, shadowColor: colors.dark.background, shadowOpacity: 0.32, shadowRadius: 12, elevation: 3 },
  planIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  planBrandMark: { width: 35, height: 35, borderRadius: 11, backgroundColor: colors.dark.primary, alignItems: 'center', justifyContent: 'center' },
  planBrandCopy: { flex: 1, minWidth: 0 },
  planBrandName: { color: colors.dark.text, fontSize: 15, fontWeight: '900', letterSpacing: 2.1, fontFamily: 'monospace' },
  planCount: { color: colors.dark.mutedForeground, fontSize: 8, marginTop: 5, letterSpacing: 0.9, fontWeight: '700' },
  planCta: { borderWidth: 1, borderColor: colors.dark.accent, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  planCtaText: { color: colors.dark.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  planStatusPill: { borderWidth: 1, borderColor: colors.dark.success, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  planStatusDot: { width: 5, height: 5, borderRadius: 5, backgroundColor: colors.dark.success },
  planStatusText: { color: colors.dark.success, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  tierBadge: { borderWidth: 1, borderRadius: 30, paddingHorizontal: 9, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tierBadgeDot: { width: 6, height: 6, borderRadius: 6 },
  tierBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  drawerRoot: { flex: 1, flexDirection: 'row' },
  drawerScrim: { backgroundColor: colors.dark.scrim },
  sideDrawer: { height: '100%', backgroundColor: colors.dark.card, borderRightWidth: 1, borderRightColor: colors.dark.borderStrong, shadowColor: colors.dark.background, shadowOpacity: 0.45, shadowRadius: 22, elevation: 16 },
  drawerContent: { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 28, gap: 10 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.dark.border },
  drawerBrandMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.dark.primary, alignItems: 'center', justifyContent: 'center' },
  drawerHeaderCopy: { flex: 1, gap: 3 },
  drawerKicker: { color: colors.dark.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
  drawerTitle: { color: colors.dark.text, fontSize: 15, fontWeight: '900', letterSpacing: 2.4 },
  drawerClose: { width: 34, height: 34, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  drawerAccessCard: { backgroundColor: colors.dark.input, borderWidth: 1, borderColor: colors.dark.borderStrong, borderRadius: 15, padding: 13, gap: 5, marginTop: 4 },
  drawerAccessTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  drawerAccessLabel: { color: colors.dark.mutedForeground, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  drawerAccessTier: { color: colors.dark.text, fontSize: 20, fontWeight: '900', letterSpacing: 0.6 },
  drawerAccessMeta: { color: colors.dark.mutedForeground, fontSize: 9, letterSpacing: 0.4 },
  drawerSectionLabel: { color: colors.dark.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1.5, marginTop: 10, marginBottom: 1 },
  drawerAction: { minHeight: 61, padding: 10, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 13, backgroundColor: colors.dark.input, flexDirection: 'row', alignItems: 'center', gap: 10 },
  drawerActionDisabled: { opacity: 0.55 },
  drawerActionPressed: { backgroundColor: colors.dark.secondary, borderColor: colors.dark.borderStrong, transform: [{ scale: 0.985 }] },
  drawerActionIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.dark.secondary, alignItems: 'center', justifyContent: 'center' },
  drawerActionIconDestructive: { backgroundColor: colors.dark.failSurface },
  drawerActionCopy: { flex: 1, gap: 3 },
  drawerActionTitle: { color: colors.dark.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  drawerActionTitleDisabled: { color: colors.dark.mutedForeground },
  drawerActionSubtitle: { color: colors.dark.mutedForeground, fontSize: 9, lineHeight: 13 },
  drawerPreferenceRow: { minHeight: 61, padding: 10, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 13, backgroundColor: colors.dark.input, flexDirection: 'row', alignItems: 'center', gap: 10 },
  drawerUnitValue: { borderWidth: 1, borderColor: colors.dark.accent, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 5 },
  drawerUnitValueText: { color: colors.dark.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  drawerFooter: { borderTopWidth: 1, borderTopColor: colors.dark.border, marginTop: 12, paddingTop: 15, gap: 7 },
  drawerFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  drawerLiveDot: { width: 6, height: 6, borderRadius: 6, backgroundColor: colors.dark.success },
  drawerFooterTitle: { color: colors.dark.mutedForeground, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  drawerFooterText: { color: colors.dark.mutedForeground, fontSize: 9, lineHeight: 14 },
  hero: { paddingTop: 14, gap: 9 },
  heroEyebrow: { color: colors.dark.primary, letterSpacing: 1.8, fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
  heroTitle: { color: colors.dark.text, fontSize: 31, lineHeight: 37, letterSpacing: -1.2, fontWeight: '800', fontFamily: 'monospace' },
  heroAccent: { color: colors.dark.accent },
  heroSubtitle: { color: colors.dark.mutedForeground, fontSize: 14, lineHeight: 21, maxWidth: 350 },
  intelligenceBanner: { backgroundColor: colors.dark.guideSurface, borderWidth: 1, borderColor: colors.dark.guideBorder, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  intelligenceIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.dark.primary, alignItems: 'center', justifyContent: 'center' },
  intelligenceCopy: { flex: 1, gap: 4 },
  intelligenceTitle: { color: colors.dark.text, fontSize: 9, fontWeight: '900', letterSpacing: 0.65, fontFamily: 'monospace' },
  intelligenceBody: { color: colors.dark.mutedForeground, fontSize: 10, lineHeight: 14 },
  intelligenceSignal: { alignItems: 'center', gap: 4 },
  intelligenceSignalDot: { width: 7, height: 7, borderRadius: 7, backgroundColor: colors.dark.success },
  intelligenceSignalText: { color: colors.dark.success, fontSize: 7, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  visualCard: { backgroundColor: colors.dark.background, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 18, overflow: 'hidden' },
  visualHeader: { padding: 16, backgroundColor: colors.dark.card, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  visualHeaderCopy: { flex: 1 },
  sectionKicker: { color: colors.dark.primary, letterSpacing: 1.6, fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
  visualTitle: { color: colors.dark.text, letterSpacing: 1.1, fontSize: 14, fontWeight: '800', marginTop: 5, fontFamily: 'monospace' },
  visualCaption: { color: colors.dark.mutedForeground, fontSize: 11, marginTop: 5 },
  solvePill: { borderWidth: 1, borderColor: colors.dark.border, borderRadius: 18, paddingHorizontal: 9, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  solveDot: { width: 6, height: 6, borderRadius: 6, backgroundColor: colors.dark.mutedForeground },
  solveDotActive: { backgroundColor: colors.dark.success },
  solvePillText: { color: colors.dark.mutedForeground, fontSize: 8, letterSpacing: 1, fontWeight: '800' },
  visualFooter: { backgroundColor: colors.dark.background, borderTopWidth: 1, borderTopColor: colors.dark.border, padding: 11, flexDirection: 'row', justifyContent: 'space-between' },
  monoLabel: { color: colors.dark.mutedForeground, fontSize: 9, letterSpacing: 1.3 },
  presetCard: { backgroundColor: colors.dark.card, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 18, padding: 17, gap: 9 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTitle: { color: colors.dark.text, fontSize: 18, fontWeight: '800', marginTop: 5 },
  cardCaption: { color: colors.dark.mutedForeground, fontSize: 12, lineHeight: 18 },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderColor: colors.dark.borderStrong, borderWidth: 1, borderRadius: 13, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: colors.dark.input },
  presetChipLocked: { borderColor: colors.dark.border, opacity: 0.8 },
  presetText: { color: colors.dark.text, fontSize: 11, fontWeight: '700' },
  presetTextLocked: { color: colors.dark.mutedForeground },
  presetTier: { color: colors.dark.primary, fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
  sectionCard: { backgroundColor: colors.dark.card, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 18, padding: 17, gap: 15 },
  sectionHeader: { paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: colors.dark.border, flexDirection: 'row', justifyContent: 'space-between' },
  resetIconButton: { width: 31, height: 31, borderRadius: 10, borderWidth: 1, borderColor: colors.dark.border, alignItems: 'center', justifyContent: 'center' },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldHalf: { flex: 1 },
  fieldGroup: { gap: 7 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { color: colors.dark.text, fontSize: 13, fontWeight: '700' },
  fieldUnit: { color: colors.dark.mutedForeground, fontSize: 9, letterSpacing: 1.1 },
  input: { backgroundColor: colors.dark.input, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 11, color: colors.dark.text, minHeight: 49, paddingHorizontal: 13, fontSize: 15 },
  selectInput: { backgroundColor: colors.dark.input, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 11, minHeight: 49, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectText: { color: colors.dark.text, fontSize: 14 },
  helperText: { color: colors.dark.mutedForeground, fontSize: 8, letterSpacing: 1.2, lineHeight: 14, marginTop: -5 },
  unitHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: -2 },
  unitToggle: { borderWidth: 1, borderColor: colors.dark.border, borderRadius: 11, padding: 3, flexDirection: 'row' },
  unitOption: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 8 },
  unitSelected: { backgroundColor: colors.dark.secondary },
  unitText: { color: colors.dark.mutedForeground, fontSize: 10, letterSpacing: 1.1, fontWeight: '800' },
  unitTextSelected: { color: colors.dark.text },
  calculateButton: { minHeight: 61, backgroundColor: colors.dark.primary, borderRadius: 13, paddingLeft: 16, paddingRight: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: colors.dark.primary, shadowOpacity: 0.25, shadowRadius: 14, elevation: 5 },
  calculatePressed: { transform: [{ scale: 0.985 }], opacity: 0.88 },
  calculateEyebrow: { color: colors.dark.primaryForeground, opacity: 0.7, fontSize: 8, fontWeight: '800', letterSpacing: 1.3 },
  calculateText: { color: colors.dark.primaryForeground, fontSize: 13, fontWeight: '900', letterSpacing: 0.8, marginTop: 4 },
  calculateArrow: { width: 43, height: 43, borderRadius: 12, backgroundColor: colors.dark.primaryForeground, alignItems: 'center', justifyContent: 'center' },
  emptyCard: { backgroundColor: colors.dark.card, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 18, padding: 19, gap: 11 },
  emptyTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  emptyIcon: { width: 46, height: 46, borderWidth: 1, borderColor: colors.dark.borderStrong, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.dark.text, fontSize: 20, letterSpacing: 0.3, fontWeight: '900', marginTop: 2 },
  emptyBody: { color: colors.dark.mutedForeground, fontSize: 13, lineHeight: 20 },
  resultCard: { backgroundColor: colors.dark.card, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 18, padding: 17, gap: 11 },
  resultCardPremium: { borderColor: colors.dark.primary, shadowColor: colors.dark.primary, shadowOpacity: 0.16, shadowRadius: 18, elevation: 4 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  resultHeaderCopy: { flex: 1 },
  resultHeading: { color: colors.dark.text, fontSize: 18, fontWeight: '800', marginTop: 5 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 8 },
  statusPass: { backgroundColor: colors.dark.successSurface },
  statusFail: { backgroundColor: colors.dark.failSurface },
  statusDot: { width: 6, height: 6, borderRadius: 6, backgroundColor: colors.dark.success },
  statusDotFail: { backgroundColor: colors.dark.destructive },
  statusText: { color: colors.dark.success, fontSize: 8, letterSpacing: 0.5, fontWeight: '800' },
  statusTextFail: { color: colors.dark.destructive },
  consensusBadge: { borderWidth: 1, borderRadius: 15, minHeight: 72, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 10 },
  consensusVerified: { backgroundColor: colors.dark.successSurface, borderColor: colors.dark.success },
  consensusFailed: { backgroundColor: colors.dark.failSurface, borderColor: colors.dark.destructive },
  consensusPending: { backgroundColor: colors.dark.secondary, borderColor: colors.dark.accent },
  consensusIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.dark.input, alignItems: 'center', justifyContent: 'center' },
  consensusCopy: { flex: 1, gap: 4 },
  consensusTitle: { fontSize: 15, fontWeight: '900', letterSpacing: 0.7 },
  consensusDetail: { color: colors.dark.mutedForeground, fontSize: 8, lineHeight: 13, letterSpacing: 0.7, fontWeight: '800' },
  resultLabel: { color: colors.dark.mutedForeground, fontSize: 9, letterSpacing: 1.6, marginTop: 8 },
  resultValue: { color: colors.dark.text, fontSize: 43, lineHeight: 48, fontWeight: '900', letterSpacing: -1.3 },
  resultUnit: { color: colors.dark.primary, fontSize: 15, letterSpacing: 0 },
  laneDifference: { color: colors.dark.accent, fontSize: 10, lineHeight: 15, fontWeight: '700', marginTop: -6, letterSpacing: 0.25 },
  resultMetricRow: { borderTopWidth: 1, borderTopColor: colors.dark.border, paddingTop: 13, flexDirection: 'row', gap: 34 },
  resultMetric: { flex: 1 },
  metricLabel: { color: colors.dark.mutedForeground, fontSize: 8, letterSpacing: 1.2 },
  metricValue: { color: colors.dark.text, fontSize: 13, fontWeight: '700', marginTop: 6 },
  agentCards: { flexDirection: 'row', gap: 10 },
  agentCard: { flex: 1, minWidth: 0, minHeight: 138, backgroundColor: colors.dark.input, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 16, padding: 13, gap: 8 },
  agentCardActive: { borderTopWidth: 2, borderTopColor: colors.dark.primary, shadowColor: colors.dark.primary, shadowOpacity: 0.12, shadowRadius: 10, elevation: 2 },
  agentCardLocked: { backgroundColor: colors.dark.card, borderColor: colors.dark.border, borderTopWidth: 2, borderTopColor: colors.dark.mutedForeground },
  agentCardTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  agentCardIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.dark.secondary, alignItems: 'center', justifyContent: 'center' },
  agentCardIconLocked: { backgroundColor: colors.dark.card },
  agentCardCode: { color: colors.dark.mutedForeground, fontSize: 8, letterSpacing: 1.3, fontWeight: '900' },
  agentCardTitle: { color: colors.dark.text, fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 0.65 },
  agentCardTitleLocked: { color: colors.dark.mutedForeground },
  agentCardStatus: { color: colors.dark.mutedForeground, fontSize: 9, lineHeight: 13, minHeight: 26 },
  agentCardState: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 },
  agentStateDot: { width: 5, height: 5, borderRadius: 5, backgroundColor: colors.dark.success },
  agentStateDotLocked: { backgroundColor: colors.dark.mutedForeground },
  agentCompareGrid: { flexDirection: 'row', gap: 8 },
  agentMetricCard: { flex: 1, minWidth: 0, backgroundColor: colors.dark.input, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 13, padding: 12, gap: 7, minHeight: 118 },
  agentMetricCardLocked: { backgroundColor: colors.dark.card, borderColor: colors.dark.border },
  agentMetricHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  agentMetricTitle: { color: colors.dark.text, fontSize: 8, fontWeight: '900', letterSpacing: 0.55 },
  agentMetricTitleLocked: { color: colors.dark.mutedForeground },
  agentMetricValue: { color: colors.dark.text, fontSize: 24, lineHeight: 28, fontWeight: '900', letterSpacing: -0.5 },
  agentMetricValueLocked: { color: colors.dark.mutedForeground },
  agentMetricUnit: { color: colors.dark.primary, fontSize: 10, letterSpacing: 0 },
  agentMetricStatus: { color: colors.dark.accent, fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  agentReviewPanel: { backgroundColor: colors.dark.input, borderRadius: 13, padding: 12, gap: 6 },
  agentReviewLabel: { color: colors.dark.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  agentReviewText: { color: colors.dark.mutedForeground, fontSize: 10, lineHeight: 15 },
  realismCard: { borderWidth: 1, borderRadius: 15, padding: 13, gap: 8 },
  realismPlausible: { backgroundColor: colors.dark.successSurface, borderColor: colors.dark.success },
  realismReview: { backgroundColor: colors.dark.secondary, borderColor: colors.dark.accent },
  realismConcern: { backgroundColor: colors.dark.failSurface, borderColor: colors.dark.destructive },
  realismHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  realismIcon: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.dark.input, alignItems: 'center', justifyContent: 'center' },
  realismHeaderCopy: { flex: 1, gap: 3 },
  realismLabel: { color: colors.dark.mutedForeground, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  realismTitle: { color: colors.dark.text, fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  realismBody: { color: colors.dark.text, fontSize: 11, lineHeight: 16 },
  realismFootnote: { color: colors.dark.mutedForeground, fontSize: 7, lineHeight: 11, fontWeight: '800', letterSpacing: 0.55 },
  workingToggle: { borderWidth: 1, borderColor: colors.dark.borderStrong, borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  workingToggleCopy: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  workingToggleIcon: { width: 29, height: 29, borderRadius: 9, backgroundColor: colors.dark.secondary, alignItems: 'center', justifyContent: 'center' },
  workingToggleTitle: { color: colors.dark.text, fontSize: 9, fontWeight: '900', letterSpacing: 0.75 },
  workingToggleSubtitle: { color: colors.dark.mutedForeground, fontSize: 9, marginTop: 3 },
  workingPanel: { backgroundColor: colors.dark.background, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 15, padding: 13, gap: 12 },
  workingPanelKicker: { color: colors.dark.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  workingPanelIntro: { color: colors.dark.mutedForeground, fontSize: 10, lineHeight: 15 },
  workingStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  workingStepNumber: { width: 25, height: 25, borderRadius: 8, backgroundColor: colors.dark.secondary, alignItems: 'center', justifyContent: 'center' },
  workingStepNumberText: { color: colors.dark.primary, fontSize: 8, fontWeight: '900' },
  workingStepCopy: { flex: 1, gap: 4 },
  workingStepTitle: { color: colors.dark.text, fontSize: 8, fontWeight: '900', letterSpacing: 0.75 },
  workingStepBody: { color: colors.dark.mutedForeground, fontSize: 10, lineHeight: 15 },
  workingEquation: { color: colors.dark.text, backgroundColor: colors.dark.input, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 9, lineHeight: 14, fontFamily: 'monospace' },
  workingStepResult: { color: colors.dark.accent, fontSize: 9, lineHeight: 14, fontWeight: '800' },
  calculationBoundary: { color: colors.dark.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.8, marginTop: -3 },
  agentStateActive: { backgroundColor: colors.dark.successSurface },
  agentStateLocked: { backgroundColor: colors.dark.secondary },
  agentStateText: { color: colors.dark.success, fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  agentStateTextLocked: { color: colors.dark.mutedForeground },
  guideCard: { backgroundColor: colors.dark.guideSurface, borderWidth: 1, borderColor: colors.dark.guideBorder, borderRadius: 13, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  guideIcon: { width: 31, height: 31, borderRadius: 9, backgroundColor: colors.dark.secondary, alignItems: 'center', justifyContent: 'center' },
  guideCopy: { flex: 1, gap: 5 },
  guideTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideTitle: { color: colors.dark.accent, fontSize: 9, letterSpacing: 1.2, fontWeight: '900' },
  guideTier: { color: colors.dark.mutedForeground, fontSize: 7, letterSpacing: 0.8, fontWeight: '800' },
  guideBody: { color: colors.dark.text, fontSize: 11, lineHeight: 17 },
  guideFootnote: { color: colors.dark.mutedForeground, fontSize: 9, lineHeight: 14 },
  guideAiText: { color: colors.dark.text, fontSize: 10, lineHeight: 15, borderLeftWidth: 2, borderLeftColor: colors.dark.accent, paddingLeft: 8 },
  consensusNote: { color: colors.dark.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.6, marginTop: 2 },
  graphCard: { backgroundColor: colors.dark.card, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 18, overflow: 'hidden' },
  graphCardDisagreement: { borderColor: colors.dark.destructive },
  graphHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  graphTitle: { color: colors.dark.text, fontSize: 18, fontWeight: '800', marginTop: 5 },
  graphLegend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { width: 18, height: 3, borderRadius: 3 },
  graphLegendRows: { paddingHorizontal: 16, paddingBottom: 9, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  graphLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendNumericalLine: { height: 2 },
  legendText: { color: colors.dark.mutedForeground, fontSize: 9, letterSpacing: 0.15, fontWeight: '700' },
  zoomButton: { minHeight: 32, paddingHorizontal: 9, borderWidth: 1, borderColor: colors.dark.borderStrong, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  zoomButtonText: { color: colors.dark.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  graphZoomHint: { color: colors.dark.accent, paddingHorizontal: 16, paddingBottom: 8, fontSize: 8, fontWeight: '800', letterSpacing: 0.55 },
  graphDisagreementHint: { color: colors.dark.destructive, paddingHorizontal: 16, paddingBottom: 8, fontSize: 8, fontWeight: '900', letterSpacing: 0.65 },
  graphMetrics: { borderTopWidth: 1, borderTopColor: colors.dark.border, padding: 14, flexDirection: 'row', gap: 32 },
  graphMetricValue: { color: colors.dark.text, fontSize: 14, fontWeight: '800', marginTop: 5 },
  historyCard: { backgroundColor: colors.dark.card, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 18, padding: 16, gap: 10 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6 },
  historyTitle: { color: colors.dark.text, fontSize: 17, fontWeight: '800', marginTop: 5 },
  historyEmpty: { color: colors.dark.mutedForeground, fontSize: 12, lineHeight: 18, paddingVertical: 8 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderTopColor: colors.dark.border, paddingTop: 10 },
  historyRowIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.dark.secondary, alignItems: 'center', justifyContent: 'center' },
  historyRowCopy: { flex: 1 },
  historyRowTitle: { color: colors.dark.text, fontSize: 11, fontWeight: '700' },
  historyRowMeta: { color: colors.dark.mutedForeground, fontSize: 9, marginTop: 3 },
  historyValue: { color: colors.dark.accent, fontSize: 11, fontWeight: '800' },
  historyLock: { color: colors.dark.primary, fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
  disclaimerCard: { backgroundColor: colors.dark.card, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 16, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  disclaimerCopy: { flex: 1, gap: 4 },
  disclaimerTitle: { color: colors.dark.text, fontSize: 12, fontWeight: '800' },
  disclaimerBody: { color: colors.dark.mutedForeground, fontSize: 11, lineHeight: 17 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.dark.scrim },
  planModal: { backgroundColor: colors.dark.card, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: colors.dark.border, maxHeight: '92%' },
  historyModal: { backgroundColor: colors.dark.card, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: colors.dark.border, maxHeight: '82%', gap: 14 },
  planModalScroll: { flexGrow: 0 },
  planModalContent: { gap: 9, paddingBottom: 16 },
  modalHandle: { width: 42, height: 4, borderRadius: 4, backgroundColor: colors.dark.border, alignSelf: 'center', marginBottom: 5 },
  modalTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  modalTitleCopy: { flex: 1 },
  modalTitle: { color: colors.dark.text, fontSize: 24, fontWeight: '900', marginTop: 6 },
  closeButton: { width: 34, height: 34, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  modalBody: { color: colors.dark.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  tierCard: { backgroundColor: colors.dark.input, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 14, padding: 12, gap: 7 },
  tierCardPremium: { backgroundColor: colors.dark.premiumSurface },
  tierCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tierName: { fontSize: 11, letterSpacing: 1.4, fontWeight: '900', fontFamily: 'monospace' },
  tierDetail: { color: colors.dark.text, fontSize: 12, fontWeight: '700', marginTop: 4 },
  activePill: { backgroundColor: colors.dark.successSurface, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 4 },
  activePillText: { color: colors.dark.success, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  tierCardMeta: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  tierPrice: { color: colors.dark.text, fontSize: 16, fontWeight: '900' },
  tierLimit: { color: colors.dark.mutedForeground, fontSize: 8, letterSpacing: 0.8, fontWeight: '800' },
  tierCardDetail: { color: colors.dark.mutedForeground, fontSize: 10, lineHeight: 15 },
  tierAction: { backgroundColor: colors.dark.primary, borderRadius: 9, alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  tierActionText: { color: colors.dark.primaryForeground, fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  billingHint: { color: colors.dark.mutedForeground, fontSize: 10, lineHeight: 15, paddingVertical: 4 },
  restoreButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, padding: 6, marginTop: 2 },
  restoreText: { color: colors.dark.accent, fontSize: 11, fontWeight: '700' },
  modalFootnote: { color: colors.dark.mutedForeground, textAlign: 'center', fontSize: 9 },
  selectorBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.dark.scrim },
  selectorCard: { backgroundColor: colors.dark.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 28, gap: 8, borderTopWidth: 1, borderColor: colors.dark.border },
  selectorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 4 },
  selectorRow: { minHeight: 52, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.dark.border, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectorRowLocked: { backgroundColor: colors.dark.input },
  selectorText: { color: colors.dark.text, fontSize: 13, fontWeight: '600' },
  selectorTextLocked: { color: colors.dark.mutedForeground },
  selectorMeta: { color: colors.dark.mutedForeground, fontSize: 9, marginTop: 3 },
  errorText: { color: colors.dark.destructive, fontSize: 11, lineHeight: 17 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});