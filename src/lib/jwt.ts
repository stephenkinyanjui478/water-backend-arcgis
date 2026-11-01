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

// ---- Admin sessions ---------------------------------------------------------
// The static WSP admin client signs in (admin password) to manage the SECRET
// communication settings. A separate issuer keeps admin tokens disjoint from
// customer sessions so a customer JWT can never satisfy an admin guard.
const ADMIN_ISSUER = "wsp-admin";

export interface AdminClaims {
  sub: "admin";
  role: "admin";
}

export function signAdmin(): string {
  return jwt.sign({ sub: "admin", role: "admin" } as AdminClaims, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: ADMIN_ISSUER,
  } as SignOptions);
}

export function verifyAdmin(token: string): AdminClaims {
  return jwt.verify(token, config.jwt.secret, { issuer: ADMIN_ISSUER }) as AdminClaims;
}

// ---- Operations-console sessions --------------------------------------------
// The OAuth-gated operations console (operations-console/). After the ArcGIS
// portal authorization-code exchange, the backend issues one of these, carrying
// the authenticated portal identity. A distinct issuer keeps ops tokens disjoint
// from customer and admin sessions.
const OPS_ISSUER = "wsp-ops";

export interface OpsClaims {
  /** Subject — the portal username. */
  sub: string;
  username: string;
  fullName?: string;
  /** Portal role (for display only; enforcement is the portal's, via the user token). */
  role?: string;
  /** Opaque id of the server-side session holding this user's ArcGIS token. */
  sid?: string;
}

export function signOps(claims: OpsClaims): string {
  return jwt.sign(claims, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: OPS_ISSUER,
  } as SignOptions);
}

export function verifyOps(token: string): OpsClaims {
  return jwt.verify(token, config.jwt.secret, { issuer: OPS_ISSUER }) as OpsClaims;
}
