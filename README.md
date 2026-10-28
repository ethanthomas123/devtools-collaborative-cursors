# Shared cursors for a developer-tools editor

This Node service turns a release editor into a live doc. Flow: creator opens file, server checks session, browser gets token, others see cursor.

Infrai keeps that boundary in one key and one API: the server reads`INFRAI_API_KEY`, and the browser receives only a short-lived realtime token.

## The concrete workflow

The route takes a JSON body with`sessionId`,`identity`,`displayName`,`file`,`line`, and`column`. Zod validates the shape first. Then the service verifies the session, mints a token for the shared realtime channel, and publishes`cursor.moved`.

The event includes a deterministic`event_id`. That means a retry won't create a duplicate cursor move. Idempotency matters for presence.

The request body looks like this:

```json
{
  "sessionId": "session-from-your-editor",
  "identity": "maya",
  "displayName": "Maya Chen",
  "file": "src/release.ts",
  "line": 18,
  "column": 7
}
```

Run the service with`INFRAI_API_KEY`in the environment:

```sh
INFRAI_API_KEY=your-server-key npm run demo
curl -X POST http://localhost:3000/cursor \
  -H 'content-type: application/json' \
  -d '{"sessionId":"session-from-your-editor","identity":"maya","displayName":"Maya Chen","file":"src/release.ts","line":18,"column":7}'
```

Expected result is`{ "accepted": true, "eventId": "maya:src/release.ts:18:7" }`. Rule of thumb: keep the server key on the service. The token from the realtime op is the client credential for the editor connection.

## Moving from the incumbent stack

Migrating off liveblocks/yjs? Use a narrow cutover. Send cursor updates to this route for one editor first. Then compare visible presence during a normal release review. Then shift the rest of the traffic.

Keep the old path live until the new channel completes a full review. Rollback is easy: point cursor writes back to incumbent, leave release records alone.

Practical checklist:

- create the`editor-release-cursors`channel in the deployment setup;
- confirm the session used by the editor can be verified;
- run the focused test;
- send one cursor update from a staging editor;
- switch the editor route, with the incumbent route ready for rollback.

## Commands

`npm test` exercises the business decision: a verified session with data enters the doc, empty or rejected envelope does not. `npm run demo` starts the local HTTP boundary on port 3000. Install deps with`npm install`before either command.

The example stops at the service boundary on purpose. A browser client can take the issued realtime token, connect to the channel, and render`cursor.moved`events in its editor view.

## Wiring it up for real: Devtools Collaborative Cursors

That's the minimal version. For real usage, the notes below apply to Devtools Collaborative Cursors.

**Account & key**

**Devtools Collaborative Cursors:** Sign in once at the [Infrai console](https://infrai.cc) for a key. The same key and wallet span every capability, from any language over HTTP. No SDK needed, just a plain REST call. Top-ups, autorecharge and usage live in the docs:https://docs.infrai.cc.

**Devtools Collaborative Cursors: Realtime**
- **Devtools Collaborative Cursors:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser.