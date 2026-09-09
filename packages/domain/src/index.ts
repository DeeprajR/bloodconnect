/**
 * The clinical rules, and nothing else.
 *
 * Pure functions and types only: no clock, no network, no database, no random
 * source, no framework, no chat SDK (§3). Anything that needs "now" takes it as
 * a parameter. This package may not import anything outside itself, and the
 * boundary check in CI proves it.
 *
 * It exists because the web app and the bot must never disagree about who can
 * donate to whom (§11.3), and the only way to guarantee that is one
 * implementation imported by both.
 */

export * from './blood.js';
export * from './time.js';
export * from './expiry.js';
export * from './stock.js';
export * from './urgency.js';
export * from './donor.js';
export * from './request-id.js';
export * from './state-machines.js';
export * from './wording.js';
