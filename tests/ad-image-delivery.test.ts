import assert from "node:assert/strict";
import test from "node:test";
import { canOptimizeAdImage } from "../lib/media.ts";

test("optimizer only accepts credential-free HTTPS Facebook CDN URLs; private archives remain direct", () => {
  assert.equal(canOptimizeAdImage("https://scontent.xx.fbcdn.net/v/photo.jpg?oe=123&oh=signature"), true);
  for (const src of [
    "https://fbcdn.net.attacker.example/photo.jpg", "https://evil-fbcdn.net/photo.jpg",
    "http://scontent.xx.fbcdn.net/photo.jpg", "https://scontent.xx.fbcdn.net:8443/photo.jpg",
    "https://user:secret@scontent.xx.fbcdn.net/photo.jpg", "https://scontent.xx.fbcdn.net/photo.jpg?access_token=secret",
    "https://video.xx.fbcdn.net/ad.mp4?oe=123",
    "https://project.supabase.co/storage/v1/object/sign/private/photo.jpg?token=private",
    "http://127.0.0.1/photo.jpg", "data:image/png;base64,abc", "/api/private-image", "invalid",
  ]) assert.equal(canOptimizeAdImage(src), false, src);
});
