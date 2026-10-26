/**
 * JWT issuance and verification for customer sessions. The token carries the
 * customer's email (their identity) and display name. Secret comes from env.
 */
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { config } from "@/lib/config";

export interface CustomerClaims {
  /** Subject — the customer's lowercased email. */
  sub: string;
  email: string;
  name?: string;
}

export function signSession(claims: CustomerClaims): string {
  return jwt.sign(claims, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: config.jwt.issuer,
  } as SignOptions);
}

export function verifySession(token: string): CustomerClaims {
  return jwt.verify(token, config.jwt.secret, { issuer: config.jwt.issuer }) as CustomerClaims;
}
