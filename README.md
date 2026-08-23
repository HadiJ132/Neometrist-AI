# NEOMETRIST

A mobile-first structural engineering tool that uses **dual-AI consensus** to verify beam and wing deflection calculations. Built for field engineers and students who need reliable math away from desktop workstations.

> 🎥 [Watch the Demo Video](your-link-here)

## Why This Exists

Single-AI tools hallucinate math. In structural engineering, one wrong number can mean catastrophic failure. Neometrist runs two independent AI agents in parallel—a **Structural Physicist** and a **Mathematical Auditor**—and only accepts results when they agree within 1%.

## Architecture

| Layer | What It Does |
|-------|-------------|
| **Deterministic Pre-Calc Engine** | Node.js/TypeScript solves exact Euler-Bernoulli deflection models before any AI is called. Ground truth baseline. |
| **Tier-Aware Router** | Freemium/Promium → single AI call. Premium → true dual-agent consensus via `Promise.all`. |
| **Regex Reconciler** | Extracts `[FINAL_ANSWER_M: ...]` from both agents. If delta ≤ 1% → `VERIFIED CONSENSUS`. Otherwise → `RECONCILIATION FAILED`. |
| **Safety Demo** | Input exactly `999 kN` to force an intentional agent disagreement and trigger the failure guardrail. |

## RevenueCat Integration

| Tier | Price | What You Get |
|------|-------|--------------|
| **Freemium** | Free | 10 calcs/month, basic materials |
| **Promium** | $1.99/mo | 30 calcs, aerospace materials |
| **Premium Pro** | $4.99/mo | Unlimited, superalloys, dual-agent verification |

Demo reset: Click **[ DEMO RESET ]** to purge local state and test tier flows from scratch.

## Tech Stack

React 18 · TypeScript · Tailwind · Vite · Node.js · OpenAI API · RevenueCat SDK · HTML5 Canvas

## Quick Start

```bash
git clone https://github.com/HadiJ132/Neometrist-AI.git
cd Neometrist-AI
npm install

# Add your keys to .env
echo "OPENAI_API_KEY=your_key" >> .env
echo "REVENUECAT_API_KEY=your_key" >> .env

npm run dev
# Open http://localhost:5173
