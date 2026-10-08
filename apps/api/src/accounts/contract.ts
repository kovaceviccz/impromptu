import { z } from "zod";

import { healthSchema } from "../health/contract.js";
import { errorSchema } from "../topics/contract.js";

export const usernameSchema = z
  .string({ error: "Enter a username." })
  .trim()
  .min(1, "Enter a username.")
  .min(3, "Username must be at least 3 characters.")
  .max(30, "Username must be at most 30 characters.")
  .regex(/^[A-Za-z0-9_]+$/, "Use only letters, numbers, and underscores.");

export const emailSchema = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "Email address must be at most 254 characters.")
  .pipe(z.email("Enter a valid email address."));

export const displayNameSchema = z
  .string({ error: "Enter a display name." })
  .trim()
  .min(1, "Enter a display name.")
  .max(40, "Display name must be at most 40 characters.");

export const newPasswordSchema = z
  .string({ error: "Enter a password." })
  .min(1, "Enter a password.")
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.");

export const registerBodySchema = z.strictObject({
  username: usernameSchema,
  email: emailSchema,
  password: newPasswordSchema,
});

export const loginBodySchema = z.strictObject({
  identifier: z
    .string({ error: "Enter your username or email." })
    .trim()
    .min(1, "Enter your username or email.")
    .max(254, "Enter your username or email."),
  password: z
    .string({ error: "Enter your password." })
    .min(1, "Enter your password.")
    .max(128, "Enter your password."),
});

export const updateAccountBodySchema = z.strictObject({
  displayName: displayNameSchema,
  username: usernameSchema,
  email: emailSchema,
});

export const accountSchema = z.strictObject({
  id: z.uuid(),
  displayName: displayNameSchema,
  username: z.string().min(1),
  email: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export const accountResponseSchema = z.strictObject({ account: accountSchema });

export const sessionResponseSchema = z.strictObject({
  account: accountSchema.nullable(),
});

export const formErrorSchema = z.strictObject({
  message: z.string().min(1),
  fieldErrors: z.record(z.string(), z.string()),
});

/** Keeps the first message for each field, which is how forms display them. */
export function firstFieldErrors(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in fieldErrors)) {
      fieldErrors[field] = issue.message;
    }
  }
  return fieldErrors;
}

export const accountContracts = {
  register: {
    method: "POST",
    path: "/api/auth/register",
    body: registerBodySchema,
    response: accountResponseSchema,
    errors: { 400: formErrorSchema, 409: formErrorSchema },
  },
  login: {
    method: "POST",
    path: "/api/auth/login",
    body: loginBodySchema,
    response: accountResponseSchema,
    errors: { 400: formErrorSchema, 401: errorSchema },
  },
  logout: {
    method: "POST",
    path: "/api/auth/logout",
    response: healthSchema,
  },
  session: {
    method: "GET",
    path: "/api/auth/session",
    response: sessionResponseSchema,
  },
  account: {
    method: "GET",
    path: "/api/account",
    response: accountResponseSchema,
    errors: { 401: errorSchema },
  },
  updateAccount: {
    method: "PATCH",
    path: "/api/account",
    body: updateAccountBodySchema,
    response: accountResponseSchema,
    errors: {
      400: formErrorSchema,
      401: errorSchema,
      409: formErrorSchema,
    },
  },
  deleteAccount: {
    method: "DELETE",
    path: "/api/account",
    response: healthSchema,
    errors: { 401: errorSchema },
  },
} as const;

export type Account = z.output<typeof accountSchema>;
export type RegisterInput = z.output<typeof registerBodySchema>;
export type LoginInput = z.output<typeof loginBodySchema>;
export type UpdateAccountInput = z.output<typeof updateAccountBodySchema>;
export type FormError = z.output<typeof formErrorSchema>;
