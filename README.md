# NEOMETRIST

A mobile-first structural engineering tool that uses **dual-lane intelligence** to verify beam and wing deflection calculations.

Built for engineering and architecture students who need reliable preliminary results on mobile — without relying on a single AI answer.

> 🎥 [Watch the Demo Video](your-demo-video-link-here)

---

## Why Neometrist Exists

Most AI tools give one answer and hope it’s correct. In structural calculations, that’s not good enough.

Neometrist runs two independent lanes on every problem:

- **Physics Solver** — Closed-form Euler-Bernoulli solution  
- **Numerical Auditor** — Independent numerical method (composite integration)

Only when both lanes agree within **1%** does the result receive **Verified Consensus**.

---

## Key Features

- Dual-lane verification (Physics + Numerical)
- Real-time beam deflection visualization
- Multiple support conditions and load types
- Material presets for Civil, Architecture, Automotive, and Aerospace
- Screening limit check (L/360)
- Calculation history
- Clean mobile-first interface
- RevenueCat subscription tiers

---

## Dual-Lane Architecture

| Lane                  | Method                              | Role                          |
|-----------------------|-------------------------------------|-------------------------------|
| **Physics Solver**    | Closed-form Euler-Bernoulli         | Primary structural calculation |
| **Numerical Auditor** | Numerical integration (independent) | Verification lane             |
| **Reconciler**        | Compares both results               | Issues Verified Consensus if variance ≤ 1% |

---

## Subscription Tiers (RevenueCat)

| Tier         | Price     | What You Get                                      |
|--------------|-----------|---------------------------------------------------|
| **Freemium** | Free      | 10 calculations/month, basic materials, Physics lane only |
| **Promium**  | $1.99/mo  | 30 calculations/month + additional materials      |
| **Premium**  | $4.99/mo  | Unlimited calculations + Numerical Auditor + full consensus |

---

## Tech Stack

- React Native / Expo
- TypeScript
- OpenAI API (for explanations only)
- RevenueCat
- Deterministic calculation engine (closed-form + numerical)

---

## Getting Started

```bash
git clone https://github.com/HadiJ132/Neometrist-AI.git
cd Neometrist-AI
npm install
