# WebAudit

WebAudit accepts website audit requests over HTTP, runs Lighthouse in the API request, and stores status, scores, JSON reports, and HTML reports in MongoDB. The portal receives the finished audit results in the POST response.

## Requirements

- Node.js 22 LTS, npm, MongoDB 8, and Chrome/Chromium.
- Docker and Docker Compose for the container setup.

Each audit and its full Lighthouse JSON and HTML reports are retained for 15 days from submission. MongoDB TTL indexes remove the audit and report documents after expiration (MongoDB's TTL monitor runs periodically, so removal may happen shortly after the 15-day point).

Copy `.env.example` to `.env` and adjust values. For a local setup, start MongoDB, install dependencies with `npm install`, then run `npm run dev`. `CHROME_PATH` may point to a Chromium executable; it can be left blank when Chrome is on the system path. Keep the portal's HTTP timeout long enough for Lighthouse to finish; the default audit timeout is 120 seconds.

`npm run build` compiles the API. `npm start` runs it. `npm test`, `npm run lint`, and `npm run typecheck` run automated checks.

## Docker Compose

Copy `.env.example` to `.env`, then run `docker compose up --build`. The API is available on port 3000. Docker Compose starts the API and MongoDB; MongoDB uses a named data volume and holds audit results and reports. The API container runs as the non-root Node user with dropped Linux capabilities. Chrome still needs `--no-sandbox` in this container setup, so restrict outbound network access at the host/network policy layer for production.

## Railway deployment

Create a Railway service from this repository. Railway detects the root `Dockerfile`, which installs Chromium and sets `CHROME_PATH=/usr/bin/chromium`; no separate browser installation step or Chrome path variable is needed. In the service's Variables, set `MONGODB_URI` to the MongoDB Atlas connection string and `NODE_ENV=production`. Railway supplies `PORT`, which the API uses. In the service settings, set the health-check path to `/health`. Keep the Atlas credential in Railway Variables, not in a committed env file, and configure Atlas network access to allow the Railway service to connect.

## API

Submit an audit and wait for the completed result:

```sh
curl -X POST http://localhost:3000/api/v1/audits \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","strategy":["mobile","desktop"],"categories":["performance","accessibility","best-practices","seo"]}'
```

The request stays open while Lighthouse runs. The response is sent after analysis and contains the finished status, scores, metrics, and report URLs, for example:

```json
{
  "auditId": "generated-uuid",
  "url": "https://example.com",
  "strategy": ["mobile", "desktop"],
  "categories": ["performance", "accessibility", "best-practices", "seo"],
  "status": "completed",
  "results": [
    { "strategy": "mobile", "status": "completed", "scores": { "performance": 98 }, "metrics": { "largest-contentful-paint": 1200 }, "durationMs": 32000, "fetchedAt": "2026-11-17T00:00:00.000Z" }
  ],
  "reportUrl": "/api/v1/audits/generated-uuid/report",
  "htmlReportUrl": "/api/v1/audits/generated-uuid/report.html"
}
```

Retrieve the full Lighthouse report with:

```sh
curl http://localhost:3000/api/v1/audits/<audit-id>
curl http://localhost:3000/api/v1/audits/<audit-id>/report
curl 'http://localhost:3000/api/v1/audits/<audit-id>/report.html?strategy=mobile'
curl http://localhost:3000/health
```

The HTML report endpoint defaults to mobile if present, otherwise desktop. `strategy` can select `mobile` or `desktop`.

### AI insights

An LLM explains a finished audit: what slows the page, the evidence for each cause, and what to change. The
Lighthouse report is trimmed to its metrics and failing audits (a few KB) before it is sent, and the model is
called once per audit; the answer is stored and expires with the audit.

```sh
curl -X POST http://localhost:3000/api/v1/audits/<audit-id>/insights   # generate (once) and return
curl http://localhost:3000/api/v1/audits/<audit-id>/insights           # the stored result, never generates
```

`POST` answers `200` with the insights, `202` while another request is generating them, `409` while the audit
is still running, `503` when no model is configured, `429` when the provider rate-limits, and `502` when the
model fails or answers in an unusable shape. It has its own rate limit (`INSIGHTS_RATE_LIMIT_*`, default 5 an
hour per IP). A free model can take one to two minutes.

Any OpenAI-compatible endpoint works; set `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` (see `.env.sample`):
OpenRouter, Groq or OpenAI in production, Ollama or LM Studio locally (no key). Unset, insights are off and the
rest of the API is unaffected. On OpenRouter, `LLM_FALLBACK_MODELS` lists models to try when the first is
rate-limited. Free models come and go; `npm run llm:free-models` lists the current ones that support
structured output.

## Architecture and security

Express validates the request, creates an audit record, performs DNS checks and a redirect preflight, and runs requested Lighthouse strategies before returning the completed results. Mobile and desktop run independently in parallel. The API stores analyzed scores on the audit and compressed Lighthouse JSON/HTML in separate MongoDB documents. TTL indexes expire both the audit and its reports 15 days after submission.

URL validation accepts HTTP(S), rejects credentials, localhost, metadata hostnames, private/reserved IP ranges, and hosts resolving to any non-public address. Redirect targets are checked before Chrome starts. This preflight cannot fully prevent DNS rebinding or browser subresource requests to internal addresses; network egress controls are required for a strong SSRF boundary. Restrict the API container's egress to public internet destinations in production. Request rate limiting is in-memory per API process.

Full Lighthouse JSON and HTML are gzip-compressed before being stored in MongoDB, reducing document size while keeping report retrieval independent of filesystem paths and shared volumes. The API returns report content only after loading an existing audit record.

## V1 limitations

- Each submission holds its HTTP request open while Lighthouse runs. Portals and any reverse proxy must allow enough time for the audit to finish.
- Audit history is stored, but there is no account/authentication model, scheduled audits, or public API key management.
- PDF output and report retention/cleanup are future work.
- Category scores and key timing metrics are extracted; full reports are compressed in MongoDB and expire with the audit after 15 days.
- Redirect checking uses HEAD and some sites may reject HEAD even when normal navigation would work.
- Network isolation is environment-specific and must be enforced outside URL validation.
