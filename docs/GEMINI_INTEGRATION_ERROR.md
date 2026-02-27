# Technical Note: Gemini Integration Error (404)

**Date:** February 26, 2026
**To:** Kimi
**Subject:** 404 Error on Intelligence Terminal Gemini Request

## 📍 Issue Summary
The recently implemented Gemini integration in the **Intelligence Terminal** is failing with a `404 Not Found` error when attempting to call `generateContent`.

## 🚨 Error Log
```text
[20:37:49] INFO CRITICAL_FAULT: [GoogleGenerativeAI Error]: Error fetching from 
https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent: 
[404 Not Found] models/gemini-1.5-flash is not found for API version v1beta, 
or is not supported for generateContent.
```

## 🔍 Initial Analysis
- **The SDK:** We are using `@google/generative-ai` in the dashboard.
- **The Request:** The SDK is defaulting to the `v1beta` API endpoint.
- **The Failure:** The Google API is reporting that `gemini-1.5-flash` does not exist under the `v1beta` version or doesn't support the `generateContent` method in that specific context.

## 🛠️ Root Cause & Fix
**Root Cause:** Google has deprecated older models (`gemini-1.5-flash`, `gemini-2.0-flash`) and **new API keys can only access 2.5+ series models**.

**Fix Applied:** Changed the model name to `gemini-2.5-flash` in `apps/dashboard/src/lib/llm.ts`.

```typescript
// Before (404 Error - Model deprecated)
model: 'gemini-1.5-flash'

// After (Working for new API keys)
model: 'gemini-2.5-flash'
```

**Available models for new API keys:**
- `gemini-2.5-flash` ✅ (Recommended - Stable)
- `gemini-2.5-flash-lite` (Cost-efficient, higher throughput)
- `gemini-2.5-pro` (Advanced reasoning)
- `gemini-3-flash-preview` (Preview version)

## 📂 Related Files
- `apps/dashboard/src/lib/llm.ts`: Contains the `chatWithFalken` logic.
- `apps/dashboard/src/app/api/terminal/route.ts`: The API endpoint handling terminal queries.

---
**Status:** ✅ RESOLVED. Updated model to `gemini-2.0-flash`.
