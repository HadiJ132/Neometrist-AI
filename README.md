# NEOMETRIST AI // 📊 MOBILE-FIRST STRUCTURAL INTELLIGENCE COCKPIT

An advanced, real-time aerospace and civil structural engineering diagnostic platform optimized for field triaging, drone development validation, and rapid on-site boundary telemetry auditing away from heavy desktop workstations.

---

## 🛠️ CORE SYSTEM ARCHITECTURE

Traditional software wrapper products blindly query single generative AI prompts, resulting in devastating mathematical drift or hallucinations that are structurally catastrophic in safety-critical mechanics. Neometrist AI neutralizes this vector via a localized, **Deterministic JavaScript Pre-Calculation Engine** paired with an asynchronous **Multi-Agent Consensus Loop**.

### 1. Unified Calculation Route Pipeline
- **SI-Unit Conversion Layer:** All incoming parameters (Span Length in meters, Width/Depth in fractions of a meter, and Applied Load in Kilo-Newtons) are captured and pre-scaled directly inside our centralized server-side API route controller (`deflection.ts`).
- **Textbook Arithmetic Invariance:** Prior to executing any external network requests, the Node.js/TypeScript runtime solves exact boundary condition Euler-Bernoulli deflection models (e.g., Simple Supports with concentrated center loads or Fixed-Wing aeronautical cantilever structures with Uniform Distributed Flight Loads) to establish a mathematical ground truth baseline.

### 2. Tier-Aware Token Cost Optimization
To actively protect resource bandwidth and eliminate unnecessary API credit waste, the system implements a strict, subscription-aware routing gate:
- **Freemium & Promium Tiers:** Fires a single OpenAI model request (`gpt-4o-mini`) to generate the step-by-step physics derivation text log. The background router automatically mirrors that result array into the secondary dashboard slot to preserve front-end presentation stability.
- **Premium Pro Tier:** Engages our true concurrent **Dual-Agent Consensus Loop** using `Promise.all` async chaining. Two entirely isolated, blind AI models—the *Structural Physicist* and the *Mathematical Auditor*—evaluate the loading data concurrently while being strictly forbidden from emitting erratic scientific notations or string exponents.

### 3. Regex Reconciler & System Guardrails
- **The Variance Check:** Our front-end string filter uses specialized extraction rules to harvest numeric floats from bracketed final tag blocks (`[FINAL_ANSWER_M: ...]`). If the two independent agent values match within a tight 1% margin threshold, an electric green `[STATUS: VERIFIED CONSENSUS]` flight-clearance badge ignites.
- **The 999 kN Exception:** If an intentional anomalous input of exactly `999 kN` is registered, the system forcefully injects conflicting constant targets into the auditor agent. This deliberately triggers a calculation drift failure, displaying our bold neon-red `[STATUS: RECONCILIATION FAILED]` safety warning overlay to show off structural machine-learning guardrails on command.
- **Repeat-Click Protection:** Implements an interactive client-side input signature cache string matrix. If a user spam-clicks the primary trigger without updating input fields, the system blocks network fees and locks the button text to `[ IDENTICAL INPUT MATRIX RUNNING ]`.

---

## 💳 ENTERPRISE MONETIZATION INTERFACE (RevenueCat Integration)

The commercial workflow utilizes the official `@revenuecat/purchases-js` platform SDK wrapper package to manage highly structured user entitlement groups smoothly:
- **Freemium Level (Default):** Grants up to 10 calculations per month, limited strictly to basic civil materials (`Structural Steel`, `Reinforced Concrete`, `Glulam Timber`).
- **Promium Level ($1.99/mo):** Unlocks up to 30 monthly check cycles and opens mid-grade aerospace metallurgy filters (`Aluminum 6061-T6`, `Titanium Grade 5`, `Magnesium Alloy AZ31B`).
- **Premium Pro Level ($4.99/mo):** Provides 100% unlimited calculations, opens high-tier aerospace superalloys (`Carbon Fiber Composite`, `Inconel 718`), removes all tier button navigation frames from the header, and engages the full concurrent multi-agent verification loop.

### 🔄 Environmental Testing Controls
- **Durable State Persistence:** Successful subscription validation tokens are actively saved inside the browser's hidden local storage partition to keep paid tier states active across ordinary page reloads.
- **The Demo Reset Switch:** A prominent, warning-orange bordered `[ DEMO RESET ]` developer switch forces an absolute manual cache purge (`localStorage.clear()`), dropping all subscription status arrays instantly back to the locked Freemium baseline to allow judges to seamlessly test separate transaction walkthrough flows from scratch.

---

## 📈 TECHNOLOGY STACK & CORE PROTOCOLS

- **Frontend Core:** React 18, TypeScript, Tailwind CSS, Vite Custom Module System
- **Backend Architecture:** Server-side Node.js Runtime Router Framework (`deflection.ts`)
- **Subscription Engine:** RevenueCat Web SDK Billing Hooks Gateway Integration
- **Artificial Intelligence Routing:** OpenAI API Developer Engine (`gpt-4o-mini` Concurrent Architecture)
- **Vector Dynamics Engine:** Pure HTML5 Canvas 2D Structural Beam Deformation Rendering Component

---
*Developed by Hadi Jawd as a high-IQ, production-grade technical submission asset for the global RevenueCat Shipaton 2026 Hackathon.*
