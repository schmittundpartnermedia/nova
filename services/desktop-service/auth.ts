import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { readOrCreateDesktopToken } from "@/lib/computer/config";

export function getExpectedToken(): string {
  return readOrCreateDesktopToken();
}

export function extractBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    const dummy = randomBytes(right.length || 1);
    timingSafeEqual(dummy, Buffer.alloc(dummy.length));
    return false;
  }
  return timingSafeEqual(left, right);
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "127.0.0.1" || address === "::1" || address === ":ffff:127.0.0.1" || address === "localhost";
}
